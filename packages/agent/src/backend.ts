export const AGENT_PROVIDERS = ["claude", "copilot"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentConfig {
  provider: AgentProvider;

  mcpCommand: string;
  mcpArgs: string[];
  mcpEnv: Record<string, string>;
  cwd: string;

  model?: string;

  allowedModels?: string[];

  effort?: EffortLevel;

  systemPromptAppend: string;

  /** Resolved agent credential (Anthropic API key or Copilot GitHub token).
   *  When unset, the backend falls back to the process env / CLI login. */
  agentKey?: string;

  /**
   * Base tool names whose write path this turn may take without an approval
   * box, because the user already authorised it by typing the slash command
   * that does exactly that. Never set it from anything the model controls.
   */
  autoApprove?: string[];
}

export function effectiveModel(
  cfg: Pick<AgentConfig, "model" | "allowedModels">,
): string | undefined {
  const { model, allowedModels } = cfg;
  if (!allowedModels || allowedModels.length === 0) return model;
  return model && allowedModels.includes(model) ? model : allowedModels[0];
}

export interface TurnUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  premiumRequests?: number;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; tool: string; input: unknown; id: string }
  | { type: "tool_result"; tool: string; id: string; result: unknown }
  | { type: "approval_request"; tool: string; input: unknown; id: string }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | {
      type: "result";
      result: string;
      costUsd: number;
      sessionId: string;
      usage?: TurnUsage;
    }
  | { type: "error"; message: string };

export interface Decision {
  approve: boolean;
  message?: string;
  updatedInput?: Record<string, unknown>;
}

export interface AgentTurn {
  readonly finished: boolean;
  events(): AsyncGenerator<AgentEvent>;
  approve(id: string, decision: Decision): void;
  abort(): void;
}
