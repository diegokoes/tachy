import { sql } from "../infra/db";

/**
 * One ranking definition for all three search surfaces.
 *
 * Two rules hold everywhere:
 *
 * 1. **Each signal generates its own candidates through its own index.** A
 *    blended score computed in the SELECT list leaves the planner nothing to
 *    index on, so HNSW / GIN-tsvector / GIN-trgm all sat unused. `ORDER BY
 *    embedding <=> $1 LIMIT k`, `tsv @@ query` and `$1 <% text` each hit theirs.
 *
 * 2. **Ranks fuse, scores do not.** Cosine, ts_rank and word_similarity live on
 *    incomparable scales — adding them means whichever has the widest range
 *    decides the order. Reciprocal Rank Fusion is scale-free, so knowledge and
 *    reference results are also comparable against each other in one list.
 *
 * The nonsense case falls out of (1) rather than needing a threshold bolted on:
 * a query whose words appear nowhere produces no lexical candidates, and the
 * vector leg is gated by SEM_FLOOR, so the query returns zero rows.
 */

/** Rank-fusion damping. 60 is the value from the original RRF paper. */
export const RRF_K = 60;

/** Candidates each signal contributes before fusion. */
export const CANDIDATES = 50;

/** Per-signal fusion weight. Fuzzy is a tiebreaker, not a primary signal. */
export const RRF_WEIGHTS = { vec: 1.0, lex: 1.0, fuzzy: 0.5 } as const;

/**
 * HNSW search breadth. The default of 40 is thin once a WHERE clause filters
 * results after the index returns them.
 */
export const HNSW_EF_SEARCH = 100;

/**
 * Governs `<%`. The pg_trgm default of 0.6 is too strict to catch an error code
 * embedded in a long entry; 0.35 still rejects nonsense. Measured against the
 * live DB: 'ECONNREFUSED' <% a matching entry is true at 0.35, 'zzzzzz' is false.
 */
export const WORD_SIM_THRESHOLD = 0.35;

/**
 * Run a search with the session settings its query shapes depend on. `set local`
 * confines them to this transaction, so a pooled connection never leaks them.
 */
export async function withSearchSession<T>(
  fn: (tx: typeof sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local hnsw.ef_search = ${sql.unsafe(String(HNSW_EF_SEARCH))}`;
    await tx`set local hnsw.iterative_scan = relaxed_order`;
    await tx`set local pg_trgm.word_similarity_threshold = ${sql.unsafe(String(WORD_SIM_THRESHOLD))}`;
    return fn(tx as unknown as typeof sql);
  }) as Promise<T>;
}

/**
 * Lexical predicate: exact tokens via the 'simple' vector (error codes,
 * identifiers), stemmed tokens via the 'english' one ("printer stopped" finds
 * "printer stops"). `websearch_to_tsquery` also gives users "quoted phrases"
 * and -exclusion, and never throws on malformed input.
 */
export const ftsMatch = (
  tsv: ReturnType<typeof sql>,
  tsvEn: ReturnType<typeof sql>,
  query: string,
) =>
  sql`(${tsv} @@ websearch_to_tsquery('simple', ${query}) or ${tsvEn} @@ websearch_to_tsquery('english', ${query}))`;

export const ftsRank = (
  tsv: ReturnType<typeof sql>,
  tsvEn: ReturnType<typeof sql>,
  query: string,
) =>
  sql`greatest(ts_rank_cd(${tsv}, websearch_to_tsquery('simple', ${query})), ts_rank_cd(${tsvEn}, websearch_to_tsquery('english', ${query})))`;

/**
 * Fuse three candidate CTEs named `vec`, `lex` and `fuzzy`, each exposing
 * (id, rnk) plus its own raw signal. Emits a `fused` relation with the raw
 * signals kept for display and `rrf` for ordering.
 */
export const fusedCte = () => sql`
  ids as (
    select id from vec
    union select id from lex
    union select id from fuzzy
  ),
  fused as (
    select i.id,
           coalesce(v.cos_sim, 0)  as cos_sim,
           coalesce(l.fts_rank, 0) as fts_rank,
           coalesce(f.trgm_sim, 0) as trgm_sim,
             ${RRF_WEIGHTS.vec}   * coalesce(1.0 / (${RRF_K} + v.rnk), 0)
           + ${RRF_WEIGHTS.lex}   * coalesce(1.0 / (${RRF_K} + l.rnk), 0)
           + ${RRF_WEIGHTS.fuzzy} * coalesce(1.0 / (${RRF_K} + f.rnk), 0) as rrf
    from ids i
    left join vec   v on v.id = i.id
    left join lex   l on l.id = i.id
    left join fuzzy f on f.id = i.id
  )
`;

/** Rows come back with the raw signals; callers add relevance/grade. */
export interface RankedRow {
  cos_sim: number;
  fts_rank: number;
  trgm_sim: number;
  rrf: number;
}

/** Reject a limit that is NaN, negative, or large enough to be a mistake. */
export const clampLimit = (limit: number | undefined, fallback: number) =>
  Number.isFinite(limit) && (limit as number) > 0
    ? Math.min(Math.floor(limit as number), 100)
    : fallback;
