import { sql, jsonb } from "../infra/db";

export interface RunInput {
  workItemId?: string | null;
  userId?: string | null;
  mode: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  meta?: Record<string, unknown>;
}

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
  const price = PRICING[tier];
  return (
    ((inputTokens ?? 0) * price.in + (outputTokens ?? 0) * price.out) /
    1_000_000
  );
}

/** Record an analysis run for audit + token accounting. */
export async function recordRun(input: RunInput) {
  const cost = estimateCostUsd(
    input.model,
    input.inputTokens,
    input.outputTokens,
  );
  const meta =
    cost != null
      ? { ...(input.meta ?? {}), estimated_cost_usd: cost }
      : (input.meta ?? {});
  const [row] = await sql`
    insert into analysis_runs
      (work_item_id, user_id, mode, model, input_tokens, output_tokens, meta)
    values
      (${input.workItemId ?? null}, ${input.userId ?? null}, ${input.mode}, ${input.model ?? null},
       ${input.inputTokens ?? null}, ${input.outputTokens ?? null}, ${jsonb(meta)})
    returning id, mode, created_at
  `;
  return row;
}
