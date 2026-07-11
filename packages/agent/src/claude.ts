import { query, type Options, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  classify,
  qualify,
  READ_TOOLS,
  DISALLOWED_BUILTINS,
  MCP_SERVER,
} from "./tools";
import { effectiveModel, type AgentConfig } from "./backend";
import { TurnBase, type ApprovalGate } from "./turn";

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

export async function claudePermission(
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
  gate: ApprovalGate,
): Promise<PermissionResult> {
  const { cls } = classify(toolName);
  if (cls === "read") return { behavior: "allow", updatedInput: input };
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
  constructor(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string } = {},
  ) {
    super();
    void this.pump(prompt, cfg, opts);
  }

  private async pump(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string },
  ): Promise<void> {
    const options: Options = {
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
      canUseTool: (toolName, input, { toolUseID }) =>
        claudePermission(toolName, input, toolUseID, this.requestApproval),
      includePartialMessages: false,
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(cfg.agentKey
        ? { env: { ...process.env, ANTHROPIC_API_KEY: cfg.agentKey } }
        : {}),
    };

    try {
      for await (const msg of query({ prompt, options })) {
        if (msg.type === "assistant") {
          for (const block of msg.message.content as ContentBlock[]) {
            if (block.type === "text" && block.text) {
              this.q.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              const { cls, base } = classify(block.name ?? "");
              if (cls === "read") {
                this.q.push({
                  type: "tool_use",
                  tool: base,
                  input: block.input,
                  id: block.id ?? "",
                });
              }
            }
          }
        } else if (msg.type === "result") {
          const r = msg as {
            result?: string;
            total_cost_usd?: number;
            session_id: string;
          };
          this.q.push({
            type: "result",
            result: r.result ?? "",
            costUsd: r.total_cost_usd ?? 0,
            sessionId: r.session_id,
          });
        }
      }
    } catch (e) {
      this.q.push({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.finish();
    }
  }
}
