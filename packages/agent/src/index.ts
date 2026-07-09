import {
  query,
  type Options,
  type PermissionResult,
  type EffortLevel,
} from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./queue";
import {
  classify,
  qualify,
  READ_TOOLS,
  DISALLOWED_BUILTINS,
  MCP_SERVER,
} from "./tools";

export { READ_TOOLS, WRITE_TOOLS, classify, qualify } from "./tools";

export interface AgentConfig {
  mcpCommand: string;
  mcpArgs: string[];
  mcpEnv: Record<string, string>;
  cwd: string;

  model?: string;

  allowedModels?: string[];

  effort?: EffortLevel;

  systemPromptAppend: string;
}

export function effectiveModel(
  cfg: Pick<AgentConfig, "model" | "allowedModels">,
): string | undefined {
  const { model, allowedModels } = cfg;
  if (!allowedModels || allowedModels.length === 0) return model;
  return model && allowedModels.includes(model) ? model : allowedModels[0];
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; input: unknown; id: string }
  | { type: "approval_request"; tool: string; input: unknown; id: string }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | { type: "result"; result: string; costUsd: number; sessionId: string }
  | { type: "error"; message: string };

export interface Decision {
  approve: boolean;
  message?: string;
  updatedInput?: Record<string, unknown>;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

export class AgentTurn {
  private q = new AsyncQueue<AgentEvent>();
  private pending = new Map<string, (d: Decision) => void>();

  constructor(
    prompt: string,
    cfg: AgentConfig,
    opts: { resume?: string } = {},
  ) {
    void this.pump(prompt, cfg, opts);
  }

  events(): AsyncGenerator<AgentEvent> {
    return this.q.iterator();
  }

  approve(id: string, decision: Decision): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(decision);
    }
  }

  private canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    { toolUseID }: { toolUseID: string },
  ): Promise<PermissionResult> => {
    const { cls } = classify(toolName);
    if (cls === "read") return { behavior: "allow", updatedInput: input };
    if (cls === "denied")
      return {
        behavior: "deny",
        message: `Tool ${toolName} is not permitted. Only tachy knowledge tools are available.`,
      };

    const decision = await new Promise<Decision>((resolve) => {
      this.pending.set(toolUseID, resolve);
      this.q.push({
        type: "approval_request",
        tool: toolName,
        input,
        id: toolUseID,
      });
    });
    this.q.push({
      type: "approval_resolved",
      id: toolUseID,
      approved: decision.approve,
    });
    return decision.approve
      ? { behavior: "allow", updatedInput: decision.updatedInput ?? input }
      : { behavior: "deny", message: decision.message ?? "Denied by user." };
  };

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
      canUseTool: this.canUseTool,
      includePartialMessages: false,
      ...(opts.resume ? { resume: opts.resume } : {}),
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
      for (const [, resolve] of this.pending)
        resolve({ approve: false, message: "Turn ended." });
      this.pending.clear();
      this.q.close();
    }
  }
}

export function startTurn(
  prompt: string,
  cfg: AgentConfig,
  opts: { resume?: string } = {},
): AgentTurn {
  return new AgentTurn(prompt, cfg, opts);
}
