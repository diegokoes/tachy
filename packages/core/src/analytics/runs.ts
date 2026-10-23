import { sql, jsonb } from "../infra/db";

export interface RunInput {
  workItemId?: string | null;
  userId?: string | null;
  mode: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Input read from the prompt cache, counted apart from `inputTokens`. */
  cacheReadTokens?: number | null;
  /** Input written to the prompt cache, counted apart from `inputTokens`. */
  cacheWriteTokens?: number | null;
  meta?: Record<string, unknown>;
}

export interface TokenCounts {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

interface Rates {
  in: number;
  out: number;
  cacheRead: number;
}

/**
 * List prices in USD per million tokens, from
 * https://platform.claude.com/docs/en/about-claude/pricing (Haiku 5.5 at its
 * rate for prompts up to 100,000 tokens). A model takes the longest key its id
 * contains; a bare family name prices an id the table does not list.
 */
const PRICING: Record<string, Rates> = {
  "fable-5-1": { in: 10, out: 50, cacheRead: 0.25 },
  "fable-5": { in: 10, out: 50, cacheRead: 1 },
  "opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "opus-5": { in: 5, out: 25, cacheRead: 0.5 },
  "opus-4": { in: 5, out: 25, cacheRead: 0.5 },
  "sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1 },
  "sonnet-5": { in: 2, out: 10, cacheRead: 0.2 },
  "sonnet-4": { in: 3, out: 15, cacheRead: 0.3 },
  "haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
  "haiku-4": { in: 1, out: 5, cacheRead: 0.1 },
  fable: { in: 10, out: 50, cacheRead: 0.25 },
  opus: { in: 4, out: 20, cacheRead: 0.2 },
  sonnet: { in: 2, out: 10, cacheRead: 0.1 },
  haiku: { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

/** The 5-minute cache write rate as a multiple of the input rate. */
const CACHE_WRITE_FACTOR = 1.25;

const TOKENS_PER_MILLION = 1_000_000;

function ratesFor(model: string): Rates | undefined {
  const [key] = Object.keys(PRICING)
    .filter((name) => model.includes(name))
    .sort((a, b) => b.length - a.length);
  return key ? PRICING[key] : undefined;
}

export function estimateCostUsd(
  model: string | null | undefined,
  tokens: TokenCounts,
): number | undefined {
  if (!model) return undefined;
  const { input, output, cacheRead, cacheWrite } = tokens;
  if ([input, output, cacheRead, cacheWrite].every((n) => n == null))
    return undefined;
  const rates = ratesFor(model);
  if (!rates) return undefined;
  return (
    ((input ?? 0) * rates.in +
      (output ?? 0) * rates.out +
      (cacheRead ?? 0) * rates.cacheRead +
      (cacheWrite ?? 0) * rates.in * CACHE_WRITE_FACTOR) /
    TOKENS_PER_MILLION
  );
}

/** Record an analysis run for audit + token accounting. */
export async function recordRun(input: RunInput) {
  const cost = estimateCostUsd(input.model, {
    input: input.inputTokens,
    output: input.outputTokens,
    cacheRead: input.cacheReadTokens,
    cacheWrite: input.cacheWriteTokens,
  });
  const meta = {
    ...(input.meta ?? {}),
    ...(input.cacheReadTokens != null
      ? { cache_read_tokens: input.cacheReadTokens }
      : {}),
    ...(input.cacheWriteTokens != null
      ? { cache_write_tokens: input.cacheWriteTokens }
      : {}),
    ...(cost != null ? { estimated_cost_usd: cost } : {}),
  };
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

/** The running total the latest recorded turn of a chat session reported; null when none did. */
export async function lastSessionCostUsd(
  sessionId: string,
): Promise<number | null> {
  const [row] = await sql`
    select (meta->>'session_cost_usd')::float8 as total
    from analysis_runs
    where mode = 'chat' and meta->>'session_id' = ${sessionId}
      and (meta->>'session_cost_usd')::numeric > 0
    order by created_at desc
    limit 1
  `;
  return row ? (row.total as number) : null;
}

/**
 * A turn's own cost from the session's running totals: a resumed session
 * reports the total of all its turns as `total_cost_usd` (Claude Agent SDK
 * `SDKResultMessage`). A total below the previous one is a count that
 * restarted, and is the turn's own.
 */
export function turnCostUsd(
  sessionTotalUsd: number,
  previousTotalUsd: number | null,
): number {
  if (previousTotalUsd === null || sessionTotalUsd < previousTotalUsd)
    return sessionTotalUsd;
  return sessionTotalUsd - previousTotalUsd;
}
