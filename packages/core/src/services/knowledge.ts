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
  signals?: string[];              // error codes, config filenames, component names — the distinctive search terms
  rootCause?: string;
  resolution?: string;
  resolutionPattern?: string;      // must be a slug already in resolution_patterns; null if nothing fits
  productArea?: string;
  confidence?: string;             // normalized to lowercase on write
  structured?: Record<string, unknown>;
}

/**
 * Validate resolutionPattern against the controlled vocabulary and return its
 * description (needed for embedding text — see buildEmbedText). Throws a
 * clear error rather than letting an unknown slug surface as a raw FK
 * violation, so the caller knows to consult list_resolution_patterns first.
 */
async function resolvePatternDescription(slug: string | undefined): Promise<string> {
  if (!slug) return "";
  const [pattern] = await sql`select description from resolution_patterns where slug = ${slug}`;
  if (!pattern) {
    throw new Error(
      `Unknown resolution_pattern '${slug}'. Call list_resolution_patterns to see existing ones, or add_resolution_pattern first.`,
    );
  }
  return pattern.description as string;
}

// Curated embedding input (per review): issue_summary + symptoms + root_cause
// + the resolution pattern's human-readable description (only available here,
// via a join — the generated search_text/search_tsv columns can't join) +
// signals. Deliberately excludes product_area and any long prose
// (conversation_summary, technical_analysis): all-MiniLM-L6-v2 truncates at
// ~256 word-pieces, so the vector should stay focused on the fault and fix.
function buildEmbedText(i: { issueSummary?: string; symptoms?: string[]; rootCause?: string; signals?: string[] }, patternDescription: string): string {
  return [
    i.issueSummary, (i.symptoms ?? []).join(" "), i.rootCause, patternDescription, (i.signals ?? []).join(" "),
  ].filter(Boolean).join(" ").trim();
}

export async function saveKnowledgeEntry(i: KnowledgeInput) {
  const confidence = i.confidence ? i.confidence.toLowerCase() : null;
  const patternDescription = await resolvePatternDescription(i.resolutionPattern);
  const text = buildEmbedText(i, patternDescription);
  const embedding = text ? toVectorLiteral(await embedPassage(text)) : null;

  const [row] = await sql`
    insert into knowledge_entries
      (work_item_id, product_id, team_id, created_by, status, issue_summary, symptoms, signals,
       root_cause, resolution, resolution_pattern, product_area, confidence, structured, embedding)
    values
      (${i.workItemId ?? null}, ${i.productId ?? null}, ${i.teamId ?? null}, ${i.createdById ?? null},
       ${i.status ?? "approved"}, ${i.issueSummary ?? null}, ${i.symptoms ?? []}, ${i.signals ?? []},
       ${i.rootCause ?? null}, ${i.resolution ?? null}, ${i.resolutionPattern ?? null}, ${i.productArea ?? null},
       ${confidence}, ${sql.json((i.structured ?? {}) as any)}, ${embedding}::vector)
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
           resolution_pattern, product_area, confidence, symptoms, signals,
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
    select id, issue_summary, root_cause, resolution_pattern, symptoms, signals
    from knowledge_entries where embedding is null
  `;
  let n = 0;
  for (const r of rows) {
    const patternDescription = await resolvePatternDescription(r.resolution_pattern ?? undefined);
    const text = buildEmbedText(
      { issueSummary: r.issue_summary, rootCause: r.root_cause, symptoms: r.symptoms, signals: r.signals },
      patternDescription,
    );
    if (!text) continue;
    const vec = toVectorLiteral(await embedPassage(text));
    await sql`update knowledge_entries set embedding = ${vec}::vector where id = ${r.id}`;
    n++;
  }
  return n;
}
