import { sql } from "../infra/db";
import { notFound } from "../infra/errors";
import { embedQueryLiteral } from "../search/embeddings";
import {
  currentVector,
  needsVector,
  writeEmbeddings,
} from "../search/backfill";
import {
  CANDIDATES,
  clampLimit,
  ftsMatch,
  ftsRank,
  fusedCte,
  withSearchSession,
} from "../search/rank";
import { SEM_FLOOR, withRelevance } from "../search/relevance";

export interface BucketSearchOptions {
  bucketIds: string[];
  /** Keep to one branch of the source's tree, matched on leading path segments. */
  pathPrefix?: string[];
  limit?: number;
  queryVector?: string;
}

/**
 * Hybrid search over bucket docs, ranked as reference docs are: the vector leg
 * judges a doc by its best chunk, the lexical and fuzzy legs by the whole page.
 */
export async function searchBucket(query: string, opts: BucketSearchOptions) {
  const limit = clampLimit(opts.limit, 6);
  if (!query.trim() || !opts.bucketIds.length) return [];
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));
  const prefix = opts.pathPrefix?.filter(Boolean) ?? [];

  const filters = sql`
    d.bucket_id = any(${opts.bucketIds}::uuid[])
    ${prefix.length ? sql`and d.path[1:${prefix.length}] = ${prefix}::text[]` : sql``}
  `;

  const rows = await withSearchSession(
    (tx) => tx`
    with
    chunk_hits as (
      select c.doc_id, c.chunk_text,
             1 - (c.embedding <=> ${qvec}::vector) as cos_sim
      from bucket_doc_chunks c
      join bucket_docs d on d.id = c.doc_id
      where ${filters} and c.embedding is not null and ${currentVector("c")}
        and 1 - (c.embedding <=> ${qvec}::vector) >= ${SEM_FLOOR}
      order by c.embedding <=> ${qvec}::vector
      limit ${CANDIDATES}
    ),
    best_chunk as (
      select distinct on (doc_id) doc_id as id, chunk_text as snippet, cos_sim
      from chunk_hits
      order by doc_id, cos_sim desc
    ),
    vec as (
      select id, row_number() over (order by cos_sim desc) as rnk, cos_sim
      from best_chunk
    ),
    lex as (
      select d.id,
             row_number() over (order by ${ftsRank(sql`d.search_tsv`, sql`d.search_tsv_en`, query)} desc) as rnk,
             ${ftsRank(sql`d.search_tsv`, sql`d.search_tsv_en`, query)} as fts_rank
      from bucket_docs d
      where ${filters} and ${ftsMatch(sql`d.search_tsv`, sql`d.search_tsv_en`, query)}
      order by ${ftsRank(sql`d.search_tsv`, sql`d.search_tsv_en`, query)} desc
      limit ${CANDIDATES}
    ),
    fuzzy as (
      select d.id,
             row_number() over (order by word_similarity(${query}, d.search_text) desc) as rnk,
             word_similarity(${query}, d.search_text) as trgm_sim
      from bucket_docs d
      where ${filters} and ${query} <% d.search_text
      order by word_similarity(${query}, d.search_text) desc
      limit ${CANDIDATES}
    ),
    ${fusedCte()}
    select d.id, bk.slug as bucket, d.external_key as key, d.title, d.url,
           array_to_string(d.path, ' > ') as breadcrumb, d.version, d.modified_at,
           coalesce(b.snippet, left(d.body, 400)) as snippet,
           f.cos_sim, f.fts_rank, f.trgm_sim, f.rrf
    from fused f
    join bucket_docs d on d.id = f.id
    join buckets bk on bk.id = d.bucket_id
    left join best_chunk b on b.id = f.id
    order by f.rrf desc, d.modified_at desc nulls last
    limit ${limit}
  `,
  );
  return (rows as unknown as Parameters<typeof withRelevance>[0][]).map(
    withRelevance,
  );
}

/** One doc in full, by the pusher's key or by its tachy id. */
export async function getBucketDoc(bucketId: string, keyOrId: string) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      keyOrId,
    );
  const [row] = await sql`
    select d.id, bk.slug as bucket, d.external_key as key, d.title, d.url,
           array_to_string(d.path, ' > ') as breadcrumb, d.version, d.modified_at,
           d.metadata, d.received_at, d.body
    from bucket_docs d
    join buckets bk on bk.id = d.bucket_id
    where d.bucket_id = ${bucketId}
      and (d.external_key = ${keyOrId} ${isUuid ? sql`or d.id = ${keyOrId}::uuid` : sql``})
    limit 1
  `;
  if (!row) throw notFound(`no document '${keyOrId}' in this bucket`);
  return row;
}

/** Newest first, for the admin panel's look inside a bucket. */
export async function listBucketDocs(bucketId: string, limit = 50) {
  return sql`
    select d.id, d.external_key as key, d.title, d.url,
           array_to_string(d.path, ' > ') as breadcrumb, d.modified_at, d.received_at
    from bucket_docs d
    where d.bucket_id = ${bucketId}
    order by d.received_at desc
    limit ${clampLimit(limit, 50)}
  `;
}

/**
 * Embed the chunks a bucket's batches left without vectors, or every bucket's
 * with no id. Loops until none are left, so batches accepted while it runs are
 * covered by the same run. `all` re-embeds everything, after a model change.
 */
export async function embedBucketChunks(
  opts: { bucketId?: string; all?: boolean; signal?: AbortSignal } = {},
): Promise<number> {
  const scope = opts.bucketId ? sql`and d.bucket_id = ${opts.bucketId}` : sql``;
  if (opts.all) {
    const rows = await sql`
      select c.id, c.chunk_text from bucket_doc_chunks c
      join bucket_docs d on d.id = c.doc_id
      where true ${scope}
      order by c.doc_id, c.ordinal
    `;
    return writeEmbeddings(
      "bucket_doc_chunks",
      rows.map((r) => ({ id: r.id, text: r.chunk_text })),
    );
  }
  let total = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    const rows = await sql`
      select c.id, c.chunk_text from bucket_doc_chunks c
      join bucket_docs d on d.id = c.doc_id
      where ${needsVector("c")} ${scope}
      order by c.doc_id, c.ordinal
      limit 256
    `;
    if (!rows.length) return total;
    total += await writeEmbeddings(
      "bucket_doc_chunks",
      rows.map((r) => ({ id: r.id, text: r.chunk_text })),
    );
  }
}
