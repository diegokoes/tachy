import type { ReportReview, ReportType } from "@tachy/core";
import type { ScopeContext } from "@tachy/core/config";
import { firstJsonObject, runAdvisory } from "./advisory";

const REVIEW_SYSTEM = `You review draft bug reports and feature requests for an internal knowledge tool called tachy (an AI support/engineering assistant with a chat, a library of knowledge entries and wiki articles, source connectors, and an admin panel).

Judge only whether the draft gives an admin enough to act on. For a bug: are the steps, the expected result and what actually happened clear? For a feature: is the ask specific and plausible for this kind of app? Be brief and constructive. Never rewrite the report for them.

Reply with ONLY a JSON object, no prose and no code fences:
{"ok": boolean, "suggestions": string[]}
"ok" is true when the draft is already actionable. "suggestions" is at most three short, concrete things to add or clarify (empty when ok).`;

function reviewPrompt(title: string, text: string, type: ReportType): string {
  const label = type === "bug" ? "BUG REPORT" : "FEATURE REQUEST";
  return `Draft ${label}\n\nTitle: ${title}\n\n${text}`;
}

/** Pull the verdict out of the model's answer without trusting its framing:
 *  find the first JSON object, coerce the shape, and never throw. */
export function parseReview(raw: string): ReportReview {
  const parsed = firstJsonObject(raw);
  if (!parsed) return advisoryPass();
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter((s): s is string => typeof s === "string")
        .slice(0, 3)
    : [];
  return {
    available: true,
    ok: parsed.ok === true || suggestions.length === 0,
    suggestions,
  };
}

const advisoryPass = (): ReportReview => ({
  available: true,
  ok: true,
  suggestions: [],
});

/**
 * Ask the caller's configured model whether a draft report is actionable.
 * Advisory only: when no credential resolves the form is told review is
 * unavailable, and any failure of the call itself passes silently rather than
 * trapping the person behind a model they never set up.
 */
export async function reviewReport(
  draft: { title: string; body: string },
  type: ReportType,
  ctx: ScopeContext,
  userId: string | null,
): Promise<ReportReview> {
  const text = await runAdvisory(
    {
      system: REVIEW_SYSTEM,
      prompt: (scrub) =>
        reviewPrompt(scrub(draft.title), scrub(draft.body), type),
      tier: "cheap",
      timeoutMs: 30_000,
      mode: "review",
      meta: { report_type: type },
    },
    ctx,
    userId,
  );
  if (text === null) return { available: false, ok: true, suggestions: [] };
  return parseReview(text);
}
