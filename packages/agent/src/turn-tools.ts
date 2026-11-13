/**
 * A turn's tachy tools: the tools process the api starts for the turn, offered
 * to Claude Code as an in-process server over Claude Code's own channel. A
 * write reaches the tools process only as the person approved it. With
 * TACHY_TURN_SANDBOX on, the process runs in a container of its own.
 */
import { isDeepStrictEqual } from "node:util";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation";
import { CHECK_TOOL, errorText, log } from "@tachy/core/infra";
import { openSandbox } from "@tachy/sandbox";
import { SandboxTransport } from "./sandbox-transport";
import { isSandboxed, launcherSocket } from "./sandboxed-spawn";
import { classifyCall, MCP_SERVER, qualify } from "./tools";

/** Claude Code bounds no tool call; this keeps a hung tools process from holding a turn. */
const TOOL_CALL_TIMEOUT_MS = 10 * 60_000;
/** A check reads and embeds at most; past this the box is shown without it. */
const CHECK_TIMEOUT_MS = 30_000;
const EDITED_VALUE_CHARS = 300;
/** Kept for the log when the process does not start. Its own log lines reach the api over TACHY_LOG_URL. */
const STDERR_TAIL_CHARS = 2_000;

export interface ToolsProcess {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

interface Approval {
  tool: string;
  input: Record<string, unknown>;
  /** Set when the person changed the model's draft in the review box. */
  editNote?: string;
}

export interface Refusal {
  text: string;
  /** The tool throws it, in words a person can act on; else it is a result the tool returns. */
  thrown: boolean;
}

const clipped = (value: unknown) =>
  typeof value === "string" && value.length > EDITED_VALUE_CHARS
    ? `${value.slice(0, EDITED_VALUE_CHARS)}…`
    : (value ?? null);

/**
 * What a result tells the model of a person's edit: the transcript keeps the
 * model's own draft. Null when they changed nothing.
 */
export function editNote(
  drafted: Record<string, unknown>,
  approved: Record<string, unknown>,
): string | null {
  const fields = [
    ...new Set([...Object.keys(drafted), ...Object.keys(approved)]),
  ].filter((field) => !isDeepStrictEqual(drafted[field], approved[field]));
  if (!fields.length) return null;
  const values = Object.fromEntries(
    fields.map((field) => [field, clipped(approved[field])]),
  );
  return `The user edited this call in the review box, and it ran with their values, not yours: ${JSON.stringify(values)}. Report their values, and keep them in any call that follows from this one.`;
}

const textOf = (result: CallToolResult) =>
  result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

/** Ajv starts each of its comma-joined errors with `data`: `data/symptoms must be array`. */
const readable = (ajvMessage: string) =>
  ajvMessage.replace(/(^|, )data\//g, "$1").replace(/(^|, )data /g, "$1input ");

export class TurnTools {
  readonly server: McpServer;
  private readonly approvals: Approval[] = [];
  private readonly schemas = new Map<string, JsonSchemaType>();
  /** Null for a schema Ajv cannot compile: that tool is left to the tools process. */
  private readonly validators = new Map<
    string,
    JsonSchemaValidator<unknown> | null
  >();
  private readonly ajv = new AjvJsonSchemaValidator();
  private offersCheck = false;

  constructor(
    private readonly client: Client,
    private readonly proxiedTools: readonly string[] = [],
  ) {
    // The SDK takes an McpServer. Its own tool registry stays empty: both
    // handlers forward to the turn's tools process.
    this.server = new McpServer(
      { name: MCP_SERVER, version: "1" },
      { capabilities: { tools: {} }, instructions: client.getInstructions() },
    );
    this.server.server.setRequestHandler(
      ListToolsRequestSchema,
      async (request) => {
        const listed = await client.listTools(request.params);
        for (const tool of listed.tools)
          this.schemas.set(tool.name, tool.inputSchema as JsonSchemaType);
        this.offersCheck ||= this.schemas.has(CHECK_TOOL);
        // The gate's own tool: a model has no use for it.
        return {
          ...listed,
          tools: listed.tools.filter((tool) => tool.name !== CHECK_TOOL),
        };
      },
    );
    this.server.server.setRequestHandler(CallToolRequestSchema, (request) =>
      this.forward(request),
    );
  }

  get serverConfig(): McpSdkServerConfigWithInstance {
    return { type: "sdk", name: MCP_SERVER, instance: this.server };
  }

  /** Lets one write through, once, with exactly this input. `drafted`: the model's own. */
  allow(
    tool: string,
    input: Record<string, unknown>,
    drafted: Record<string, unknown> = input,
  ): void {
    const note = editNote(drafted, input);
    this.approvals.push({ tool, input, ...(note ? { editNote: note } : {}) });
  }

  /**
   * Why the tools process would refuse this write, asked before a person is;
   * null when it would run, or when the check itself fails.
   */
  async refusal(tool: string, input: unknown): Promise<Refusal | null> {
    if (!this.offersCheck) return null;
    try {
      const answer = await this.client.request(
        {
          method: "tools/call",
          params: { name: CHECK_TOOL, arguments: { tool, input } },
        },
        CallToolResultSchema,
        { timeout: CHECK_TIMEOUT_MS },
      );
      const text = textOf(answer);
      return text ? { text, thrown: answer.isError === true } : null;
    } catch (err) {
      log("warn", "tool_check_failed", { tool, error: errorText(err) });
      return null;
    }
  }

  /**
   * Why `input` does not fit the schema the tools process listed for `tool`,
   * or null when it fits or the tool was not listed. Never stricter than the
   * tools process: its own check also runs a tool's refinements.
   */
  inputProblem(tool: string, input: unknown): string | null {
    const validate = this.validatorFor(tool);
    if (!validate) return null;
    const result = validate(input);
    return result.valid ? null : readable(result.errorMessage);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async forward(request: CallToolRequest): Promise<CallToolResult> {
    const { name, arguments: input = {} } = request.params;
    const { cls } = classifyCall(qualify(name), input, this.proxiedTools);
    const approval =
      cls === "read" ? undefined : this.takeApproval(name, input);
    if (cls !== "read" && !approval)
      return {
        isError: true,
        content: [{ type: "text", text: `${name} was not approved` }],
      };
    const result = await this.client.request(
      { method: "tools/call", params: request.params },
      CallToolResultSchema,
      { timeout: TOOL_CALL_TIMEOUT_MS },
    );
    if (!approval?.editNote) return result;
    return {
      ...result,
      content: [...result.content, { type: "text", text: approval.editNote }],
    };
  }

  private validatorFor(tool: string): JsonSchemaValidator<unknown> | null {
    const cached = this.validators.get(tool);
    if (cached !== undefined) return cached;
    const schema = this.schemas.get(tool);
    if (!schema) return null;
    let validator: JsonSchemaValidator<unknown> | null = null;
    try {
      validator = this.ajv.getValidator(schema);
    } catch (err) {
      log("warn", "tool_schema_unchecked", { tool, error: errorText(err) });
    }
    this.validators.set(tool, validator);
    return validator;
  }

  private takeApproval(
    tool: string,
    input: Record<string, unknown>,
  ): Approval | undefined {
    const index = this.approvals.findIndex(
      (approval) =>
        approval.tool === tool && isDeepStrictEqual(approval.input, input),
    );
    return index < 0 ? undefined : this.approvals.splice(index, 1)[0];
  }
}

/** The container's command is fixed, so it takes only the process's env. */
function toolsTransport(
  toolsProcess: ToolsProcess,
  onStderr: (text: string) => void,
): Transport {
  if (isSandboxed()) {
    const sandbox = openSandbox(
      { kind: "tools", args: [], env: toolsProcess.env },
      { socketPath: launcherSocket(), onStderr },
    );
    // A launcher refusal arrives as an error, not on stderr.
    sandbox.on("error", (error: Error) => onStderr(`${error.message}\n`));
    return new SandboxTransport(sandbox);
  }
  const transport = new StdioClientTransport({
    ...toolsProcess,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => onStderr(chunk.toString()));
  return transport;
}

export async function startTurnTools(
  toolsProcess: ToolsProcess,
  proxiedTools: readonly string[] = [],
): Promise<TurnTools> {
  let stderrTail = "";
  const transport = toolsTransport(toolsProcess, (text) => {
    stderrTail = (stderrTail + text).slice(-STDERR_TAIL_CHARS);
  });
  const client = new Client({ name: "tachy-turn", version: "1" });
  try {
    await client.connect(transport);
  } catch (err) {
    log("error", "turn_tools_start_failed", {
      error: errorText(err),
      stderr: stderrTail,
    });
    throw new Error(
      "tachy's tools did not start for this turn; the server log has the reason",
    );
  }
  return new TurnTools(client, proxiedTools);
}
