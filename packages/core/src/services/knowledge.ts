import { sql } from "../db";
import { embedPassage, embedQuery, toVectorLiteral } from "../embeddings";

export interface KnowledgeInput {
  workItemId?: string | null;
  productId?: string | null;
  teamId?: string | null;
  createdById?: string | null;
  status?: string;
  issueSummary?: string;
  symptoms?: string[];
  signals?: string[];
  rootCause?: string;
  resolution?: string;
  resolutionPattern?: string;
  productArea?: string;
  confidence?: string;
  structured?: Record<string, unknown>;
}

export interface KnowledgeUpdateInput {
  status?: string;
  issueSummary?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  resolutionPattern?: string | null;
  symptoms?: string[];
  signals?: string[];
  productArea?: string | null;
  confidence?: string | null;
  structured?: Record<string, unknown>;
  expectedVersion?: number;
}

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

// Embeds: issue_summary, symptoms, root_cause, pattern description (richer than slug), signals.
// Excludes product_area — all-MiniLM-L6-v2 truncates at ~256 tokens, keep it fault-focused.
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

// Hybrid search: FTS + trigram + semantic cosine, blended into a single score.
export async function searchKnowledge(query: string, opts: SearchOptions = {}) {
  const limit = opts.limit ?? 8;
  if (!query.trim()) return [];
  const qvec = toVectorLiteral(await embedQuery(query));
  const rows = await sql`
    select id, work_item_id, status, issue_summary, root_cause, resolution,
           resolution_pattern, product_area, confidence, symptoms, signals, structured, version,
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

export async function getKnowledgeEntry(id: string) {
  const [row] = await sql`
    select id, work_item_id, product_id, team_id, status, issue_summary,
           symptoms, signals, root_cause, resolution, resolution_pattern,
           product_area, confidence, structured, version, created_at, updated_at
    from knowledge_entries where id = ${id}
  `;
  if (!row) throw new Error(`Knowledge entry '${id}' not found`);
  return row;
}

export async function listKnowledgeEntries(opts: { status?: string; productId?: string; teamId?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 50;
  return sql`
    select id, work_item_id, product_id, team_id, status, issue_summary,
           root_cause, resolution, resolution_pattern, product_area, confidence,
           symptoms, signals, version, created_at, updated_at
    from knowledge_entries
    where 1=1
      ${opts.status    ? sql`and status     = ${opts.status}`    : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId    ? sql`and team_id    = ${opts.teamId}`    : sql``}
    order by updated_at desc
    limit ${limit}
  `;
}

export async function updateKnowledgeEntry(id: string, patch: KnowledgeUpdateInput) {
  const [current] = await sql`
    select status, issue_summary, root_cause, resolution, resolution_pattern,
           symptoms, signals, product_area, confidence, structured, version
    from knowledge_entries where id = ${id}
  `;
  if (!current) throw new Error(`Knowledge entry '${id}' not found`);

  if (patch.expectedVersion != null && current.version !== patch.expectedVersion) {
    throw new Error(`Version conflict: expected ${patch.expectedVersion}, found ${current.version}`);
  }

  const merged = {
    status:            patch.status                  ?? current.status,
    issueSummary:      'issueSummary'      in patch ? patch.issueSummary      : current.issue_summary,
    rootCause:         'rootCause'         in patch ? patch.rootCause         : current.root_cause,
    resolution:        'resolution'        in patch ? patch.resolution        : current.resolution,
    resolutionPattern: 'resolutionPattern' in patch ? patch.resolutionPattern : current.resolution_pattern,
    symptoms:          patch.symptoms                ?? current.symptoms,
    signals:           patch.signals                 ?? current.signals,
    productArea:       'productArea'       in patch ? patch.productArea       : current.product_area,
    confidence:        'confidence'        in patch ? (patch.confidence?.toLowerCase() ?? null) : current.confidence,
    structured:        patch.structured              ?? current.structured,
  };

  const contentChanged =
    merged.issueSummary      !== current.issue_summary      ||
    merged.rootCause         !== current.root_cause         ||
    merged.resolutionPattern !== current.resolution_pattern ||
    (merged.symptoms ?? []).join('\0') !== (current.symptoms ?? []).join('\0') ||
    (merged.signals  ?? []).join('\0') !== (current.signals  ?? []).join('\0');

  let vec: string | null = null;
  if (contentChanged) {
    const patternDescription = await resolvePatternDescription(merged.resolutionPattern ?? undefined);
    const text = buildEmbedText(
      { issueSummary: merged.issueSummary ?? undefined, symptoms: merged.symptoms, rootCause: merged.rootCause ?? undefined, signals: merged.signals },
      patternDescription,
    );
    vec = text ? toVectorLiteral(await embedPassage(text)) : null;
  }

  const [row] = await sql`
    update knowledge_entries set
      status             = ${merged.status},
      issue_summary      = ${merged.issueSummary ?? null},
      root_cause         = ${merged.rootCause ?? null},
      resolution         = ${merged.resolution ?? null},
      resolution_pattern = ${merged.resolutionPattern ?? null},
      symptoms           = ${merged.symptoms ?? []},
      signals            = ${merged.signals ?? []},
      product_area       = ${merged.productArea ?? null},
      confidence         = ${merged.confidence ?? null},
      structured         = ${sql.json((merged.structured ?? {}) as any)},
      version            = version + 1
      ${contentChanged ? (vec ? sql`, embedding = ${vec}::vector` : sql`, embedding = null`) : sql``}
    where id = ${id}
    returning id, status, version
  `;
  return row;
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
