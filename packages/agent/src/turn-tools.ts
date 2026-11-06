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
import { errorText, log } from "@tachy/core/infra";
import { openSandbox } from "@tachy/sandbox";
import { SandboxTransport } from "./sandbox-transport";
import { isSandboxed, launcherSocket } from "./sandboxed-spawn";
import { classifyCall, MCP_SERVER, qualify } from "./tools";

/** Claude Code bounds no tool call; this keeps a hung tools process from holding a turn. */
const TOOL_CALL_TIMEOUT_MS = 10 * 60_000;
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
}

export class TurnTools {
  readonly server: McpServer;
  private readonly approvals: Approval[] = [];

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
    this.server.server.setRequestHandler(ListToolsRequestSchema, (request) =>
      client.listTools(request.params),
    );
    this.server.server.setRequestHandler(CallToolRequestSchema, (request) =>
      this.forward(request),
    );
  }

  get serverConfig(): McpSdkServerConfigWithInstance {
    return { type: "sdk", name: MCP_SERVER, instance: this.server };
  }

  /** Lets one write through, once, with exactly this input. */
  allow(tool: string, input: Record<string, unknown>): void {
    this.approvals.push({ tool, input });
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async forward(request: CallToolRequest): Promise<CallToolResult> {
    const { name, arguments: input = {} } = request.params;
    const { cls } = classifyCall(qualify(name), input, this.proxiedTools);
    if (cls !== "read" && !this.takeApproval(name, input))
      return {
        isError: true,
        content: [{ type: "text", text: `${name} was not approved` }],
      };
    return this.client.request(
      { method: "tools/call", params: request.params },
      CallToolResultSchema,
      { timeout: TOOL_CALL_TIMEOUT_MS },
    );
  }

  private takeApproval(tool: string, input: Record<string, unknown>): boolean {
    const index = this.approvals.findIndex(
      (approval) =>
        approval.tool === tool && isDeepStrictEqual(approval.input, input),
    );
    if (index < 0) return false;
    this.approvals.splice(index, 1);
    return true;
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
