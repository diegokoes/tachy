import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveSettings,
  effectivePrefs,
  resolveAgentAuth,
  recordRun,
  scrubText,
  TokenMap,
  type ReportReview,
  type ReportType,
  type ScopeContext,
} from "@tachy/core";
import { completeOnce } from "@tachy/agent";

/**
 * A cheap tier for the advisory: the review is a short judgement, not a turn.
 * Only used on Claude; on Copilot the caller's own model answers, since a Claude
 * id would be rejected there. `allowed_models`, when an org sets it, still
 * clamps this away in `effectiveModel`.
 */
const VALIDATION_MODEL_CLAUDE = "claude-haiku-4-5-20251001";

const REVIEW_SYSTEM = `You review draft bug reports and feature requests for an internal knowledge tool called tachy (an AI support/engineering assistant with a chat, a library of knowledge entries and wiki articles, source connectors, and an admin panel).

Judge only whether the draft gives an admin enough to act on. For a bug: are the steps, the expected result and what actually happened clear? For a feature: is the ask specific and plausible for this kind of app? Be brief and constructive. Never rewrite the report for them.

Reply with ONLY a JSON object, no prose and no code fences:
{"ok": boolean, "suggestions": string[]}
"ok" is true when the draft is already actionable. "suggestions" is at most three short, concrete things to add or clarify (empty when ok).`;

function reviewPrompt(title: string, text: string, type: ReportType): string {
  const label = type === "bug" ? "BUG REPORT" : "FEATURE REQUEST";
  return `Draft ${label}\n\nTitle: ${title}\n\n${text}`;
}

async function emptySessionDir(): Promise<string> {
  const dir = join(tmpdir(), "tachy-agent-empty");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Pull the verdict out of the model's answer without trusting its framing:
 *  find the first JSON object, coerce the shape, and never throw. */
function parseReview(raw: string): ReportReview {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return advisoryPass();
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      ok?: unknown;
      suggestions?: unknown;
    };
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
  } catch {
    return advisoryPass();
  }
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
  const [settings, prefs] = await Promise.all([
    effectiveSettings(),
    effectivePrefs(ctx),
  ]);
  const provider = prefs.agent_provider.value;
  const agentAuth = await resolveAgentAuth(provider, ctx);
  if (!agentAuth) return { available: false, ok: true, suggestions: [] };

  const tokens = new TokenMap();
  const scrub = (s: string) =>
    settings.redaction_global.value ? scrubText(s, tokens) : s;
  const model =
    provider === "claude" ? VALIDATION_MODEL_CLAUDE : prefs.agent_model.value;
  const allowedModels = settings.allowed_models.value;

  try {
    const res = await completeOnce(
      reviewPrompt(scrub(draft.title), scrub(draft.body), type),
      {
        provider,
        model,
        ...(allowedModels.length ? { allowedModels } : {}),
        agentAuth,
        systemPrompt: REVIEW_SYSTEM,
        ...(provider === "copilot"
          ? { sessionCwd: await emptySessionDir() }
          : {}),
      },
      { timeoutMs: 30_000 },
    );
    await recordRun({
      userId,
      mode: "review",
      model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      meta: { report_type: type, backend_cost_usd: res.costUsd },
    });
    return parseReview(res.text);
  } catch {
    return advisoryPass();
  }
}
