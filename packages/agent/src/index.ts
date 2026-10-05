import { ClaudeTurn } from "./claude";
import type { AgentConfig, AgentTurn } from "./backend";

export {
  READ_TOOLS,
  WRITE_TOOLS,
  CONDITIONAL_WRITES,
  classify,
  classifyCall,
  qualify,
} from "./tools";
export {
  claudePermission,
  claudeEnv,
  claudeOptions,
  BUILTIN_TOOLS,
  explainFailure,
} from "./claude";
export { userStateDir } from "./state";
export { completeOnce } from "./complete";
export { runAdvisory, firstJsonObject, type Advisory } from "./advisory";
export { reviewTicket, type ReviewRequest } from "./ticket-review";
export { reviewReport } from "./report-review";
export { registerAgentFlowActions } from "./flow-actions";
export { listModels } from "./models";
export type { ModelChoice, ModelListConfig } from "./models";
export type { CompletionConfig, CompletionResult } from "./complete";
export type { ApprovalGate } from "./turn";
export {
  effectiveModel,
  type AgentConfig,
  type AgentAuth,
  type AgentErrorKind,
  type AgentEvent,
  type AgentTurn,
  type Decision,
  type AgentEffort,
  type TurnUsage,
} from "./backend";

export function startTurn(
  prompt: string,
  cfg: AgentConfig,
  opts: { resume?: string } = {},
): AgentTurn {
  return new ClaudeTurn(prompt, cfg, opts);
}
