// A second list here meant adding a backend updated half the system: core
// re-exports the contract's, and this package used to define its own because
// it had no dependency on the contract. The contract has none of its own, so
// taking it costs nothing.
import type { AgentProvider, AgentEffort } from "@tachy/contract";

export {
  AGENT_PROVIDERS,
  AGENT_EFFORTS,
  type AgentProvider,
  type AgentEffort,
} from "@tachy/contract";

/** Why a turn failed, when the cause is known and the user can act on it. */
export type AgentErrorKind =
  "rate_limit" | "no_credential" | "bad_credential" | "other";

/** Resolved credential for a turn. Mirrors the shape `@tachy/core` produces. */
export interface AgentAuth {
  kind: "anthropic_api_key" | "anthropic_oauth" | "copilot_token";
  value: string;
}

export interface AgentConfig {
  provider: AgentProvider;

  mcpCommand: string;
  mcpArgs: string[];
  mcpEnv: Record<string, string>;
  cwd: string;

  model?: string;

  allowedModels?: string[];

  effort?: AgentEffort;

  systemPromptAppend: string;

  /**
   * Per-user Claude Code state directory (credentials, session transcripts).
   * Must be stable for a user across turns: a fresh directory mints a new
   * machine identity and orphans the transcripts that `resume` needs.
   */
  configDir?: string;

  /** Resolved agent credential. When unset, the backend falls back to the
   *  process env / CLI login. */
  agentAuth?: AgentAuth;

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
  | { type: "error"; message: string; kind?: AgentErrorKind };

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
