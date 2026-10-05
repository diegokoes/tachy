import {
  effectiveSettings,
  effectivePrefs,
  resolveAgentAuth,
  type ScopeContext,
} from "@tachy/core/config";
import { recordRun } from "@tachy/core/analytics";
import { scrubText, TokenMap } from "@tachy/core/compliance";
import { completeOnce } from "./complete";

/**
 * A cheap tier for short judgements. `allowed_models`, when an org sets it,
 * still clamps this away in `effectiveModel`.
 */
const CHEAP_MODEL = "claude-haiku-4-5-20251001";

export interface Advisory {
  system: string;
  /** Built with the org's redaction applied to whatever it passes through. */
  prompt: (scrub: (s: string) => string) => string;
  /** "cheap" for a quick verdict, "caller" when the judgement is the product. */
  tier: "cheap" | "caller";
  timeoutMs: number;
  /** analysis_runs.mode */
  mode: string;
  meta?: Record<string, unknown>;
}

/**
 * One prompt through the caller's own model credential, with no tools. Returns
 * null when no credential resolves, and "" when the call itself fails: advice
 * that cannot be given must never block what it was advising on.
 */
export async function runAdvisory(
  a: Advisory,
  ctx: ScopeContext,
  userId: string | null,
): Promise<string | null> {
  const [settings, prefs] = await Promise.all([
    effectiveSettings(),
    effectivePrefs(ctx),
  ]);
  const agentAuth = await resolveAgentAuth(ctx);
  if (!agentAuth) return null;

  const tokens = new TokenMap();
  const scrub = (s: string) =>
    settings.redaction_global.value ? scrubText(s, tokens) : s;
  const model = a.tier === "cheap" ? CHEAP_MODEL : prefs.agent_model.value;
  const allowedModels = settings.allowed_models.value;

  try {
    const res = await completeOnce(
      a.prompt(scrub),
      {
        model,
        ...(allowedModels.length ? { allowedModels } : {}),
        agentAuth,
        systemPrompt: a.system,
      },
      { timeoutMs: a.timeoutMs },
    );
    await recordRun({
      userId,
      mode: a.mode,
      model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      meta: { ...(a.meta ?? {}), backend_cost_usd: res.costUsd },
    });
    return res.text;
  } catch {
    return "";
  }
}

/** The first JSON object in a model's answer, whatever it wrapped it in. */
export function firstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
