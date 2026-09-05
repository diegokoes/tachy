/**
 * The controlled vocabularies come from `@tachy/contract` — the same lists the
 * API validates against and `db/schema.sql` constrains. Re-exported here so the
 * SPA's call sites have one import to reach for.
 */
import {
  AGENT_PROVIDERS,
  CONFIDENCES,
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
} from "@tachy/contract";
import type { AgentProvider } from "@tachy/contract";

export {
  AGENT_PROVIDERS,
  CONFIDENCES,
  RESOLUTION_CLARITIES,
  KNOWLEDGE_STATUSES,
  REFERENCE_STATUSES,
};

/**
 * The provider dropdown, in the contract's order. Only the labels live here —
 * they are copy, not vocabulary — and keying them by AgentProvider is what makes
 * a new backend a type error in the SPA rather than a silently short list.
 */
const PROVIDER_LABELS: Record<AgentProvider, string> = {
  claude: "claude (Anthropic)",
  copilot: "copilot (GitHub)",
};

export const PROVIDER_OPTIONS = AGENT_PROVIDERS.map((value) => ({
  value,
  label: PROVIDER_LABELS[value],
}));

/**
 * Keys whose values come from a fixed list wherever they appear — used to give
 * a tool-input field a dropdown instead of a free-text box.
 */
export const ENUM_FIELDS: Record<string, readonly string[]> = {
  confidence: CONFIDENCES,
  resolution_clarity: RESOLUTION_CLARITIES,
  status: KNOWLEDGE_STATUSES,
};
