/**
 * One ranking definition for every search surface. Two rules:
 *
 * 1. Each signal generates its own candidates through its own index: `ORDER BY
 *    embedding <=> $1 LIMIT k` (HNSW), `tsv @@ query` (GIN tsvector) and
 *    `$1 <% text` (GIN trigram). A blended score in the SELECT list gives the
 *    planner nothing to index on.
 * 2. Ranks fuse, scores do not. Cosine, `ts_rank` and `word_similarity` are on
 *    incomparable scales; Reciprocal Rank Fusion is scale-free, which also
 *    makes knowledge and reference results comparable in one list.
 *
 * A query whose words appear nowhere returns no rows without a threshold: it
 * has no lexical candidates, and the vector leg is gated by `SEM_FLOOR`.
 */
import { sql } from "../infra/db";
import { MAX_PAGE } from "@tachy/contract";

/** Rank-fusion damping. 60 is the value from the original RRF paper. */
export const RRF_K = 60;

/** Candidates each signal contributes before fusion. */
export const CANDIDATES = 50;

/** Per-signal fusion weight. Fuzzy is a tiebreaker, not a primary signal. */
export const RRF_WEIGHTS = { vec: 1.0, lex: 1.0, fuzzy: 0.5 } as const;

/**
 * What one top-ranked fuzzy signal is worth, so it is on the fused scale.
 * Small: a customer's own history wins a tie and never buries a better
 * general answer.
 */
export const CUSTOMER_BOOST = 0.5 / (RRF_K + 1);

/**
 * Below `CUSTOMER_BOOST`: a unit is a narrower claim than a customer, so it
 * moves a result less. A sibling unit on the same profile is weaker again.
 */
export const UNIT_BOOST = CUSTOMER_BOOST / 2;
export const SIBLING_UNIT_BOOST = CUSTOMER_BOOST / 4;

/**
 * HNSW search breadth. The default of 40 is thin once a WHERE clause filters
 * results after the index returns them.
 */
export const HNSW_EF_SEARCH = 100;

/**
 * Governs `<%`. The pg_trgm default of 0.6 misses an error code embedded in a
 * long entry; this still rejects nonsense.
 */
export const WORD_SIM_THRESHOLD = 0.35;

/**
 * Run a search with the session settings its query shapes depend on. `set local`
 * confines them to this transaction, so a pooled connection never leaks them.
 */
export async function withSearchSession<T>(
  search: (tx: typeof sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local hnsw.ef_search = ${sql.unsafe(String(HNSW_EF_SEARCH))}`;
    await tx`set local hnsw.iterative_scan = relaxed_order`;
    await tx`set local pg_trgm.word_similarity_threshold = ${sql.unsafe(String(WORD_SIM_THRESHOLD))}`;
    return search(tx as unknown as typeof sql);
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
 * Fuses three candidate CTEs named `vec`, `lex` and `fuzzy`, each exposing
 * (id, rnk) and its raw signal, into `fused`: the raw signals plus `rrf` to
 * order by. `boost` names a table with (id, customer_id) whose rows for
 * `customerId` are lifted, and with `unitId` that unit's rows and, less, its
 * profile siblings'. A lift, never a filter: other customers' rows stay.
 */
export const fusedCte = (
  boost?: { table: string; customerId: string; unitId?: string | null } | null,
) => sql`
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
           + ${RRF_WEIGHTS.fuzzy} * coalesce(1.0 / (${RRF_K} + f.rnk), 0)
           ${
             boost
               ? // Both branches cast: Postgres types the parameter from the
                 // literal it sits beside, and a bare 0 makes the boost an int.
                 sql`+ coalesce((select case when b.customer_id = ${boost.customerId}
                                            then ${CUSTOMER_BOOST}::float8
                                            else 0::float8 end
                        from ${sql.unsafe(boost.table)} b where b.id = i.id), 0::float8)
                     ${
                       boost.unitId
                         ? sql`+ coalesce((select case
                                    when b.customer_unit_id = ${boost.unitId}
                                      then ${UNIT_BOOST}::float8
                                    when b.customer_unit_id is not null
                                     and exists (
                                       select 1 from customer_units mine, customer_units theirs
                                       where mine.id = ${boost.unitId}
                                         and theirs.id = b.customer_unit_id
                                         and mine.profile_id is not null
                                         and mine.profile_id = theirs.profile_id)
                                      then ${SIBLING_UNIT_BOOST}::float8
                                    else 0::float8 end
                             from ${sql.unsafe(boost.table)} b where b.id = i.id), 0::float8)`
                         : sql``
                     }`
               : sql``
           } as rrf
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

/**
 * `fallback` for a limit that is NaN or not positive; otherwise capped at
 * `MAX_PAGE`.
 */
export const clampLimit = (limit: number | undefined, fallback: number) =>
  Number.isFinite(limit) && (limit as number) > 0
    ? Math.min(Math.floor(limit as number), MAX_PAGE)
    : fallback;
