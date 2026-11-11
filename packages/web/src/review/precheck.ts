import type {
  PrecheckCode,
  PrecheckFinding,
  ProposalPrecheck,
} from "@tachy/contract";

const CHECK_LINES: Record<PrecheckCode, string> = {
  near_copy: "nearly the same as an entry that exists:",
  no_root_cause: "no root cause, and confidence is not low",
  no_resolution: "no resolution",
  no_component: "filed under no component",
  no_source: "no ticket and no link to rest on",
};

export const checkLine = (finding: PrecheckFinding) =>
  CHECK_LINES[finding.code];

/**
 * The model's remarks as lines. None while it has no credential to read with;
 * a proposal still waiting says the model has not read it yet.
 */
export function adviceLines(
  precheck: ProposalPrecheck | null,
  { waiting }: { waiting: boolean },
): string[] {
  const advice = precheck?.advice;
  if (!advice) return waiting ? ["the model has not read this yet"] : [];
  if (!advice.available) return [];
  return advice.suggestions.length
    ? advice.suggestions
    : ["the model has no remarks"];
}
