import {
  query,
  type Options,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import {
  classify,
  classifyCall,
  qualify,
  READ_TOOLS,
  DISALLOWED_BUILTINS,
  MCP_SERVER,
} from "./tools";
import {
  effectiveModel,
  type AgentConfig,
  type AgentErrorKind,
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
 * Credential sources Claude Code consults ahead of CLAUDE_CODE_OAUTH_TOKEN.
 * Any one of these left in the inherited environment silently outranks the
 * caller's own credential and bills the wrong account.
 */
const OUTRANKING_CREDENTIAL_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

/**
 * Turn a Claude Code failure string into something a chat user can act on.
 * These three arrive as ordinary errors and are otherwise indistinguishable
 * from a crash, though only one of them means anything is actually broken.
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
      }. The turn was not lost — send it again once the limit resets.`,
    };
  if (/not logged in|run \/login/i.test(raw))
    return {
      kind: "no_credential",
      message:
        "No Claude credential is set for your account. Add one under Settings › Keys.",
    };
  if (/invalid api key|fix external api key/i.test(raw))
    return {
      kind: "bad_credential",
      message:
        "Your saved Claude credential was rejected. It may be expired, revoked, or saved in the wrong field — re-add it under Settings › Keys.",
    };
  return { kind: "other", message: raw };
}

/**
 * Environment for the spawned `claude` process. The SDK replaces the child
 * environment wholesale, so the inherited one is copied for PATH and friends,
 * then every credential source is stripped before the caller's own is set.
 */
export function claudeEnv(cfg: AgentConfig): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (typeof v === "string") env[k] = v;
  for (const k of OUTRANKING_CREDENTIAL_VARS) delete env[k];

  if (cfg.agentAuth?.kind === "anthropic_api_key")
    env.ANTHROPIC_API_KEY = cfg.agentAuth.value;
  else if (cfg.agentAuth?.kind === "anthropic_oauth")
    env.CLAUDE_CODE_OAUTH_TOKEN = cfg.agentAuth.value;

  if (cfg.configDir) env.CLAUDE_CONFIG_DIR = cfg.configDir;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}

export async function claudePermission(
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
  gate: ApprovalGate,
  autoApprove: string[] = [],
): Promise<PermissionResult> {
  const { cls, base } = classifyCall(toolName, input);
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

export class ClaudeTurn extends TurnBase {
  private controller = new AbortController();

  constructor(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string } = {},
  ) {
    super();
    void this.pump(prompt, cfg, opts);
  }

  protected onAbort(): void {
    this.controller.abort();
  }

  private async pump(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string },
  ): Promise<void> {
    const options: Options = {
      abortController: this.controller,
      model: effectiveModel(cfg),
      ...(cfg.effort ? { effort: cfg.effort } : {}),
      cwd: cfg.cwd,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: cfg.systemPromptAppend,
      },
      settingSources: [],
      permissionMode: "default",
      allowedTools: READ_TOOLS.map(qualify),
      disallowedTools: DISALLOWED_BUILTINS,
      mcpServers: {
        [MCP_SERVER]: {
          type: "stdio",
          command: cfg.mcpCommand,
          args: cfg.mcpArgs,
          env: cfg.mcpEnv,
        },
      },
      canUseTool: async (toolName, input, { toolUseID }) => {
        const res = await claudePermission(
          toolName,
          input,
          toolUseID,
          this.requestApproval,
          cfg.autoApprove,
        );
        // Read tools announce themselves off the assistant block; a write only
        // becomes real once allowed, and the UI needs to know it is running.
        const { cls, base } = classifyCall(toolName, input);
        if (res.behavior === "allow" && cls === "write")
          this.q.push({ type: "tool_use", tool: base, input, id: toolUseID });
        return res;
      },
      includePartialMessages: false,
      ...(opts.resume ? { resume: opts.resume } : {}),
      env: claudeEnv(cfg),
    };

    const pending = new Map<string, string>();
    try {
      for await (const msg of query({ prompt, options })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content as ContentBlock[]) {
            if (block.type === "text" && block.text) {
              this.q.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              const { cls, base } = classifyCall(block.name ?? "", block.input);
              if (cls === "read") {
                this.q.push({
                  type: "tool_use",
                  tool: base,
                  input: block.input,
                  id: block.id ?? "",
                });
              }
              if (block.id) pending.set(block.id, base);
            }
          }
        } else if (msg.type === "user") {
          const content = (msg as { message?: { content?: unknown } }).message
            ?.content;
          if (Array.isArray(content))
            for (const block of content as ContentBlock[]) {
              if (block.type !== "tool_result") continue;
              const id = (block as { tool_use_id?: string }).tool_use_id ?? "";
              const tool = pending.get(id);
              if (!tool) continue;
              pending.delete(id);
              this.q.push({
                type: "tool_result",
                tool,
                id,
                result: (block as { content?: unknown }).content,
              });
            }
        } else if (msg.type === "result") {
          const r = msg as {
            result?: string;
            total_cost_usd?: number;
            session_id: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          this.q.push({
            type: "result",
            result: r.result ?? "",
            costUsd: r.total_cost_usd ?? 0,
            sessionId: r.session_id,
            usage: {
              inputTokens: r.usage?.input_tokens ?? null,
              outputTokens: r.usage?.output_tokens ?? null,
            },
          });
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      this.q.push({ type: "error", ...explainFailure(raw) });
    } finally {
      this.finish();
    }
  }
}
