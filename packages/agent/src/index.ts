import { ClaudeTurn } from "./claude";
import { CopilotTurn } from "./copilot";
import type { AgentConfig, AgentTurn } from "./backend";

export { READ_TOOLS, WRITE_TOOLS, classify, qualify } from "./tools";
export { claudePermission } from "./claude";
export { copilotPermission } from "./copilot";
export type { ApprovalGate } from "./turn";
export {
  AGENT_PROVIDERS,
  effectiveModel,
  type AgentProvider,
  type AgentConfig,
  type AgentEvent,
  type AgentTurn,
  type Decision,
  type EffortLevel,
  type TurnUsage,
} from "./backend";

export function startTurn(
  prompt: string,
  cfg: AgentConfig,
  opts: { resume?: string } = {},
): AgentTurn {
  return cfg.provider === "copilot"
    ? new CopilotTurn(prompt, cfg, opts)
    : new ClaudeTurn(prompt, cfg, opts);
}
