import { sql } from "../db";

export interface KnowledgeInput {
  workItemId?: string | null;
  productId?: string | null;
  teamId?: string | null;
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

export async function saveKnowledgeEntry(i: KnowledgeInput) {
  const [row] = await sql`
    insert into knowledge_entries
      (work_item_id, product_id, team_id, status, issue_summary, symptoms,
       root_cause, resolution, resolution_pattern, product_area, confidence, structured)
    values
      (${i.workItemId ?? null}, ${i.productId ?? null}, ${i.teamId ?? null}, ${i.status ?? "approved"},
       ${i.issueSummary ?? null}, ${i.symptoms ?? []}, ${i.rootCause ?? null}, ${i.resolution ?? null},
       ${i.resolutionPattern ?? null}, ${i.productArea ?? null}, ${i.confidence ?? null},
       ${sql.json((i.structured ?? {}) as any)})
    returning id, status
  `;
  return row;
}

export interface SearchOptions {
  productId?: string;
  teamId?: string;
  limit?: number;
}

/** Hybrid keyword search over approved entries: FTS (simple) blended with trigram similarity. */
export async function searchKnowledge(query: string, opts: SearchOptions = {}) {
  const limit = opts.limit ?? 8;
  const rows = await sql`
    select id, work_item_id, status, issue_summary, root_cause, resolution,
           resolution_pattern, product_area, confidence, symptoms,
           ts_rank(search_tsv, plainto_tsquery('simple', ${query})) as fts_rank,
           similarity(search_text, ${query}) as trgm_sim
    from knowledge_entries
    where status = 'approved'
      and (search_tsv @@ plainto_tsquery('simple', ${query}) or search_text % ${query})
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and team_id = ${opts.teamId}` : sql``}
    order by (ts_rank(search_tsv, plainto_tsquery('simple', ${query})) + similarity(search_text, ${query})) desc
    limit ${limit}
  `;
  return rows;
}
