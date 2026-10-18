import { errorText } from "@tachy/core/infra";
import {
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  classifyCall,
  proxiedReads,
  qualify,
  READ_TOOLS,
  MCP_SERVER,
} from "./tools";
import {
  effectiveModel,
  type AgentConfig,
  type AgentErrorKind,
  type SessionFacts,
} from "./backend";
import { TurnBase, type ApprovalGate } from "./turn";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

/**
 * What the Claude Code process inherits from the server, named rather than
 * copied. It hands its whole environment on to the MCP child, so a copy puts
 * the vault key, the session secret and every server token in both. No
 * credential source is listed: one left in outranks the caller's own and bills
 * the wrong account.
 */
const INHERITED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  // A proxy on the way out, and the certificates it re-signs with.
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Where the model answers, when that is not Anthropic's own endpoint.
  "ANTHROPIC_BASE_URL",
];

/**
 * A Claude Code failure string as something a chat user can act on. The three
 * matched here arrive as ordinary errors, the same as a crash.
 */
export function explainFailure(raw: string): {
  message: string;
  kind: AgentErrorKind;
} {
  const resets = /resets\s+([^\n·]+)/i.exec(raw)?.[1]?.trim();
  if (/session limit/i.test(raw))
    return {
      kind: "rate_limit",
      message: `Your Claude subscription has hit its usage limit${
        resets ? `, which resets ${resets}` : ""
      }. The turn was not lost - send it again once the limit resets.`,
    };
  if (/not logged in|run \/login/i.test(raw))
    return {
      kind: "no_credential",
      message:
        "No Claude credential is set for your account. Add one under Settings › agent.",
    };
  if (/invalid api key|fix external api key/i.test(raw))
    return {
      kind: "bad_credential",
      message:
        "Your saved Claude credential was rejected. It may be expired, revoked, or saved in the wrong field - re-add it under Settings › agent.",
    };
  return { kind: "other", message: raw };
}

/**
 * Environment for the spawned `claude` process. The SDK replaces the child
 * environment wholesale, so this is all of it: the named variables the server
 * has set, then the caller's own credential.
 */
export function claudeEnv(
  config: Pick<AgentConfig, "agentAuth" | "configDir">,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (typeof value === "string") env[name] = value;
  }

  if (config.agentAuth?.kind === "anthropic_api_key")
    env.ANTHROPIC_API_KEY = config.agentAuth.value;
  else if (config.agentAuth?.kind === "anthropic_oauth")
    env.CLAUDE_CODE_OAUTH_TOKEN = config.agentAuth.value;

  if (config.configDir) env.CLAUDE_CONFIG_DIR = config.configDir;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  // A subscription token with the right scope would otherwise attach the
  // caller's personal claude.ai connectors to the turn.
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return env;
}

/**
 * Only ToolSearch survives from Claude Code's built-ins. Tool search is on by
 * default against the Anthropic API, and in that mode the first request goes
 * out before the MCP server has connected: the tachy tools are deferred and
 * reachable only through ToolSearch. Without it the model gets no tools at all.
 */
export const BUILTIN_TOOLS = ["ToolSearch"];

/**
 * Everything the model sees beyond the conversation is named here: the prompt
 * as the whole system prompt, rather than appended to the Claude Code coding
 * preset with its cwd and git status, and no settings, CLAUDE.md or .mcp.json
 * picked up from disk.
 */
export function claudeOptions(
  config: AgentConfig,
  opts: { resume?: string },
  abortController: AbortController,
  canUseTool: CanUseTool,
): Options {
  return {
    abortController,
    model: effectiveModel(config),
    ...(config.effort ? { effort: config.effort } : {}),
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    settingSources: [],
    strictMcpConfig: true,
    tools: BUILTIN_TOOLS,
    // Set so Claude Code does not spend a model call naming each session.
    title: "tachy",
    permissionMode: "default",
    allowedTools: [...READ_TOOLS, ...proxiedReads(config.proxiedTools)].map(
      qualify,
    ),
    mcpServers: {
      [MCP_SERVER]: {
        type: "stdio",
        command: config.mcpCommand,
        args: config.mcpArgs,
        env: config.mcpEnv,
      },
    },
    canUseTool,
    includePartialMessages: false,
    ...(opts.resume ? { resume: opts.resume } : {}),
    env: claudeEnv(config),
  };
}

export async function claudePermission(
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
  gate: ApprovalGate,
  autoApprove: string[] = [],
  proxied: readonly string[] = [],
): Promise<PermissionResult> {
  const { cls, base } = classifyCall(toolName, input, proxied);
  if (cls === "read") return { behavior: "allow", updatedInput: input };
  if (cls === "write" && autoApprove.includes(base))
    return { behavior: "allow", updatedInput: input };
  if (cls === "denied")
    return {
      behavior: "deny",
      message: `Tool ${toolName} is not permitted. Only tachy knowledge tools are available.`,
    };
  const decision = await gate(toolUseID, toolName, input);
  return decision.approve
    ? { behavior: "allow", updatedInput: decision.updatedInput ?? input }
    : { behavior: "deny", message: decision.message ?? "Denied by user." };
}

/**
 * A tool result as the browser is sent it. A picture a tool showed the model
 * stays on the server: the stream carries that there was one, not its bytes.
 */
export function withoutImageData(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((block: ContentBlock | null) =>
    block?.type === "image" ? { type: "image" } : block,
  );
}

/** The text blocks of an assistant message, joined. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("")
    .trim();
}

/** The start-of-turn message, cut down to what a debug view names. */
export function sessionFacts(init: SDKSystemMessage): SessionFacts {
  return {
    model: init.model,
    tools: init.tools,
    mcpServers: init.mcp_servers.map(({ name, status }) => ({ name, status })),
    credentialSource: init.apiKeySource,
    skills: init.skills,
    plugins: init.plugins.map((plugin) => plugin.name),
  };
}

export class ClaudeTurn extends TurnBase {
  private controller = new AbortController();

  constructor(
    prompt: string,
    config: AgentConfig,
    opts: { resume?: string } = {},
  ) {
    super();
    void this.pump(prompt, config, opts);
  }

  protected onAbort(): void {
    this.controller.abort();
  }

  private async pump(
    prompt: string,
    config: AgentConfig,
    opts: { resume?: string },
  ): Promise<void> {
    const options = claudeOptions(
      config,
      opts,
      this.controller,
      async (toolName, input, { toolUseID }) => {
        const permission = await claudePermission(
          toolName,
          input,
          toolUseID,
          this.requestApproval,
          config.autoApprove,
          config.proxiedTools,
        );
        // A read is announced from its assistant block. A write is announced
        // here, once allowed, so the UI shows it running.
        const { cls, base } = classifyCall(
          toolName,
          input,
          config.proxiedTools,
        );
        if (permission.behavior === "allow" && cls === "write")
          this.queue.push({
            type: "tool_use",
            tool: base,
            input,
            id: toolUseID,
          });
        return permission;
      },
    );

    const pending = new Map<string, string>();
    let answeredSessionId: string | undefined;
    let resulted = false;
    let failed = false;
    const answeredBy = new Set<string>();
    try {
      for await (const sdkMessage of query({ prompt, options })) {
        if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
          this.queue.push({ type: "session", ...sessionFacts(sdkMessage) });
        } else if (sdkMessage.type === "assistant" && sdkMessage.error) {
          // The CLI's own account of a failed API call, worded for its
          // terminal ("run /login"); the chat shows it as the turn's error.
          failed = true;
          this.queue.push({
            type: "error",
            ...explainFailure(
              textOf(sdkMessage.message.content) || sdkMessage.error,
            ),
          });
        } else if (sdkMessage.type === "assistant") {
          answeredSessionId = sdkMessage.session_id;
          if (sdkMessage.message.model)
            answeredBy.add(sdkMessage.message.model);
          for (const block of sdkMessage.message.content as ContentBlock[]) {
            if (block.type === "text" && block.text) {
              this.queue.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              const { cls, base } = classifyCall(
                block.name ?? "",
                block.input,
                config.proxiedTools,
              );
              if (cls === "read") {
                this.queue.push({
                  type: "tool_use",
                  tool: base,
                  input: block.input,
                  id: block.id ?? "",
                });
              }
              if (block.id) pending.set(block.id, base);
            }
          }
        } else if (sdkMessage.type === "user") {
          const content = (sdkMessage as { message?: { content?: unknown } })
            .message?.content;
          if (Array.isArray(content))
            for (const block of content as ContentBlock[]) {
              if (block.type !== "tool_result") continue;
              const id = (block as { tool_use_id?: string }).tool_use_id ?? "";
              const tool = pending.get(id);
              if (!tool) continue;
              pending.delete(id);
              this.queue.push({
                type: "tool_result",
                tool,
                id,
                result: withoutImageData(
                  (block as { content?: unknown }).content,
                ),
              });
            }
        } else if (sdkMessage.type === "result") {
          const resultMessage = sdkMessage as {
            result?: string;
            total_cost_usd?: number;
            session_id: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          resulted = true;
          this.queue.push({
            type: "result",
            result: resultMessage.result ?? "",
            costUsd: resultMessage.total_cost_usd ?? 0,
            sessionId: resultMessage.session_id,
            usage: {
              inputTokens: resultMessage.usage?.input_tokens ?? null,
              outputTokens: resultMessage.usage?.output_tokens ?? null,
            },
            models: [...answeredBy],
          });
        }
      }
    } catch (e) {
      // An abort reaches here as a throw; it is reported below as a stop.
      if (!this.controller.signal.aborted && !failed)
        this.queue.push({ type: "error", ...explainFailure(errorText(e)) });
    } finally {
      if (this.controller.signal.aborted && !resulted)
        this.queue.push({
          type: "stopped",
          ...(answeredSessionId ? { sessionId: answeredSessionId } : {}),
        });
      this.finish();
    }
  }
}
