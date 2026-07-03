import { sql } from "../platform/db";

export interface RunInput {
  workItemId?: string | null;
  userId?: string | null;
  mode: string;                    // 'ingest' | 'consult' | 'sync'
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  meta?: Record<string, unknown>;
}

// USD per 1M tokens, from the company AI Cost & Fair Usage guideline / Anthropic
// pricing, matched by model-id tier substring. Used to surface an estimated cost
// on each recorded run (audit only; no enforcement).
const PRICING: Record<string, { in: number; out: number }> = {
  haiku: { in: 1, out: 5 },
  sonnet: { in: 3, out: 15 },
  opus: { in: 5, out: 25 },
  fable: { in: 10, out: 50 },
};

export function estimateCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | undefined {
  if (!model || (inputTokens == null && outputTokens == null)) return undefined;
  const tier = Object.keys(PRICING).find((k) => model.includes(k));
  if (!tier) return undefined;
  const p = PRICING[tier];
  return ((inputTokens ?? 0) * p.in + (outputTokens ?? 0) * p.out) / 1_000_000;
}

/** Record an analysis run for audit + token accounting. */
export async function recordRun(i: RunInput) {
  const cost = estimateCostUsd(i.model, i.inputTokens, i.outputTokens);
  const meta = cost != null ? { ...(i.meta ?? {}), estimated_cost_usd: cost } : (i.meta ?? {});
  const [row] = await sql`
    insert into analysis_runs
      (work_item_id, user_id, mode, model, input_tokens, output_tokens, meta)
    values
      (${i.workItemId ?? null}, ${i.userId ?? null}, ${i.mode}, ${i.model ?? null},
       ${i.inputTokens ?? null}, ${i.outputTokens ?? null}, ${sql.json(meta as any)})
    returning id, mode, created_at
  `;
  return row;
}
