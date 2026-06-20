import { sql } from "../db";
import { embedPassage, embedQuery, toVectorLiteral } from "../embeddings";

export interface KnowledgeInput {
  workItemId?: string | null;
  productId?: string | null;
  teamId?: string | null;
  createdById?: string | null;     // resolved user id (TACHY_USER_EMAIL); null = anonymous
  status?: string;                 // defaults to 'approved' (called after human OK)
  issueSummary?: string;
  symptoms?: string[];
  rootCause?: string;
  resolution?: string;
  resolutionPattern?: string;
  productArea?: string;
  confidence?: string;
  structured?: Record<string, unknown>;
}

// Same fields the search_text generated column concatenates, so the stored
// embedding represents exactly what trigram/FTS see.
function embedText(i: KnowledgeInput): string {
  return [
    i.issueSummary, i.rootCause, i.resolution, i.resolutionPattern, i.productArea,
    (i.symptoms ?? []).join(" "),
  ].filter(Boolean).join(" ").trim();
}

export async function saveKnowledgeEntry(i: KnowledgeInput) {
  const text = embedText(i);
  const embedding = text ? toVectorLiteral(await embedPassage(text)) : null;
  const [row] = await sql`
    insert into knowledge_entries
      (work_item_id, product_id, team_id, created_by, status, issue_summary, symptoms,
       root_cause, resolution, resolution_pattern, product_area, confidence, structured, embedding)
    values
      (${i.workItemId ?? null}, ${i.productId ?? null}, ${i.teamId ?? null}, ${i.createdById ?? null},
       ${i.status ?? "approved"}, ${i.issueSummary ?? null}, ${i.symptoms ?? []}, ${i.rootCause ?? null},
       ${i.resolution ?? null}, ${i.resolutionPattern ?? null}, ${i.productArea ?? null},
       ${i.confidence ?? null}, ${sql.json((i.structured ?? {}) as any)}, ${embedding}::vector)
    returning id, status
  `;
  return row;
}

export interface SearchOptions {
  productId?: string;
  teamId?: string;
  limit?: number;
}

/**
 * Hybrid search over approved entries: keyword relevance (FTS + trigram) blended
 * with semantic similarity (cosine over the local embedding). Ranking all
 * approved rows lets paraphrases with no shared keywords still surface; the
 * cosine term is 0 for rows that have not been embedded yet.
 */
export async function searchKnowledge(query: string, opts: SearchOptions = {}) {
  const limit = opts.limit ?? 8;
  if (!query.trim()) return [];
  const qvec = toVectorLiteral(await embedQuery(query));
  const rows = await sql`
    select id, work_item_id, status, issue_summary, root_cause, resolution,
           resolution_pattern, product_area, confidence, symptoms,
           ts_rank(search_tsv, plainto_tsquery('simple', ${query})) as fts_rank,
           similarity(search_text, ${query}) as trgm_sim,
           coalesce(1 - (embedding <=> ${qvec}::vector), 0) as cos_sim,
           ts_rank(search_tsv, plainto_tsquery('simple', ${query}))
             + similarity(search_text, ${query})
             + coalesce(1 - (embedding <=> ${qvec}::vector), 0) as score
    from knowledge_entries
    where status = 'approved'
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and team_id = ${opts.teamId}` : sql``}
    order by score desc
    limit ${limit}
  `;
  return rows;
}

/** Compute and store embeddings for entries that don't have one yet. Returns the count embedded. */
export async function backfillEmbeddings(): Promise<number> {
  const rows = await sql`
    select id, issue_summary, root_cause, resolution, resolution_pattern, product_area, symptoms
    from knowledge_entries where embedding is null
  `;
  let n = 0;
  for (const r of rows) {
    const text = embedText({
      issueSummary: r.issue_summary, rootCause: r.root_cause, resolution: r.resolution,
      resolutionPattern: r.resolution_pattern, productArea: r.product_area, symptoms: r.symptoms,
    });
    if (!text) continue;
    const vec = toVectorLiteral(await embedPassage(text));
    await sql`update knowledge_entries set embedding = ${vec}::vector where id = ${r.id}`;
    n++;
  }
  return n;
}
