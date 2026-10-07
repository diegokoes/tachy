import type { AgentEffort } from "@tachy/contract";

export { AGENT_EFFORTS, type AgentEffort } from "@tachy/contract";

/** Why a turn failed, when the cause is known and the user can act on it. */
export type AgentErrorKind =
  "rate_limit" | "no_credential" | "bad_credential" | "other";

/** Resolved credential for a turn. Mirrors the shape `@tachy/core` produces. */
export interface AgentAuth {
  kind: "anthropic_api_key" | "anthropic_oauth";
  value: string;
}

export interface AgentConfig {
  mcpCommand: string;
  mcpArgs: string[];
  mcpEnv: Record<string, string>;
  /**
   * Where the MCP server runs, so its relative entry point resolves, and where
   * the Claude session runs. Claude Code files transcripts under this path, so
   * changing it orphans every session `resume` needs.
   */
  cwd: string;

  model?: string;

  allowedModels?: string[];

  effort?: AgentEffort;

  /** The whole system prompt. */
  systemPrompt: string;

  /**
   * Per-user state directory: Claude Code's credentials and transcripts. Stable
   * for a user across turns: a fresh directory mints a new machine identity
   * and orphans what `resume` needs.
   */
  configDir?: string;

  /**
   * The caller's credential. Unset, only a login stored under `configDir`
   * authenticates: `claudeEnv` strips the host's own from the environment.
   */
  agentAuth?: AgentAuth;

  /**
   * Base tool names whose write path this turn may take without an approval
   * box, because the user already authorised it by typing the slash command
   * that performs it. Never set it from anything the model controls.
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
  | { type: "error"; message: string; kind?: AgentErrorKind };

export interface Decision {
  approve: boolean;
  message?: string;
  updatedInput?: Record<string, unknown>;
}

export interface AgentTurn {
  readonly finished: boolean;
  /** Approval requests still waiting on the user. */
  readonly pendingApprovals: number;
  /** When the longest-waiting approval was requested (ms epoch), or null. */
  readonly oldestPendingApprovalAt: number | null;
  events(): AsyncGenerator<AgentEvent>;
  approve(id: string, decision: Decision): void;
  abort(): void;
}
