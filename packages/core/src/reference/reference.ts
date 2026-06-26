import { sql } from "../platform/db";
import { chunkText } from "../search/chunk";
import { embedPassage, embedQuery, toVectorLiteral } from "../search/embeddings";
import { notFound, conflict } from "../platform/errors";
import { parseStructured } from "../knowledge/structured";

export interface ReferenceDocInput {
  productId?: string | null;
  teamId?: string | null;
  createdById?: string | null;
  source?: string;
  title: string;
  body: string;
  tags?: string[];
  status?: string;
  structured?: Record<string, unknown>;
}

export interface ReferenceDocUpdate {
  title?: string;
  body?: string;
  tags?: string[];
  status?: string;
  source?: string | null;
  structured?: Record<string, unknown>;
  expectedVersion?: number;
}

async function embedChunks(docId: string, body: string): Promise<number> {
  const chunks = chunkText(body);
  let ordinal = 0;
  for (const text of chunks) {
    const vec = toVectorLiteral(await embedPassage(text));
    await sql`
      insert into reference_doc_chunks (doc_id, ordinal, chunk_text, embedding)
      values (${docId}, ${ordinal}, ${text}, ${vec}::vector)
    `;
    ordinal++;
  }
  return chunks.length;
}

export async function saveReferenceDoc(i: ReferenceDocInput) {
  const structured = parseStructured(i.structured);
  const [doc] = await sql`
    insert into reference_docs
      (product_id, team_id, created_by, source, title, body, tags, status, structured)
    values
      (${i.productId ?? null}, ${i.teamId ?? null}, ${i.createdById ?? null}, ${i.source ?? null},
       ${i.title}, ${i.body}, ${i.tags ?? []}, ${i.status ?? "approved"}, ${sql.json(structured as any)})
    returning id, status, version
  `;
  const chunks = await embedChunks(doc.id, i.body);
  return { id: doc.id as string, status: doc.status as string, version: doc.version as number, chunks };
}

export async function getReferenceDoc(id: string) {
  const [row] = await sql`
    select id, product_id, team_id, source, title, body, tags, status, structured,
           version, created_at, updated_at
    from reference_docs where id = ${id}
  `;
  if (!row) throw notFound(`Reference doc '${id}' not found`);
  return row;
}

export async function listReferenceDocs(opts: { status?: string; productId?: string; teamId?: string; tags?: string[]; limit?: number } = {}) {
  const limit = opts.limit ?? 50;
  return sql`
    select id, product_id, team_id, source, title, tags, status, version, created_at, updated_at
    from reference_docs
    where 1=1
      ${opts.status    ? sql`and status     = ${opts.status}`    : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId    ? sql`and team_id    = ${opts.teamId}`    : sql``}
      ${opts.tags && opts.tags.length ? sql`and tags && ${opts.tags}` : sql``}
    order by updated_at desc
    limit ${limit}
  `;
}

export async function updateReferenceDoc(id: string, patch: ReferenceDocUpdate) {
  const [current] = await sql`
    select title, body, tags, status, source, structured, version
    from reference_docs where id = ${id}
  `;
  if (!current) throw notFound(`Reference doc '${id}' not found`);
  if (patch.expectedVersion != null && current.version !== patch.expectedVersion) {
    throw conflict(`Version conflict: expected ${patch.expectedVersion}, found ${current.version}`);
  }

  const merged = {
    title:      patch.title  ?? current.title,
    body:       'body'   in patch ? (patch.body ?? "")   : current.body,
    tags:       patch.tags   ?? current.tags,
    status:     patch.status ?? current.status,
    source:     'source' in patch ? patch.source : current.source,
    structured: 'structured' in patch ? parseStructured(patch.structured) : current.structured,
  };
  const bodyChanged = merged.body !== current.body;

  const [row] = await sql`
    update reference_docs set
      title      = ${merged.title},
      body       = ${merged.body},
      tags       = ${merged.tags ?? []},
      status     = ${merged.status},
      source     = ${merged.source ?? null},
      structured = ${sql.json((merged.structured ?? {}) as any)},
      version    = version + 1
    where id = ${id}
    returning id, status, version
  `;

  if (bodyChanged) {
    await sql`delete from reference_doc_chunks where doc_id = ${id}`;
    await embedChunks(id, merged.body);
  }
  return row;
}

export interface ReferenceSearchOptions {
  productId?: string;
  teamId?: string;
  tags?: string[];
  limit?: number;
}

// Rank approved docs by their best-matching chunk (cosine) blended with doc-level
// FTS + trigram. Returns the closest chunk as `snippet` rather than the full body.
export async function searchReferenceDocs(query: string, opts: ReferenceSearchOptions = {}) {
  const limit = opts.limit ?? 6;
  if (!query.trim()) return [];
  const qvec = toVectorLiteral(await embedQuery(query));
  return sql`
    select d.id, d.title, d.tags, d.product_id, d.team_id, d.status, d.version, d.structured,
           (array_agg(c.chunk_text order by (c.embedding <=> ${qvec}::vector) asc))[1] as snippet,
           ts_rank(d.search_tsv, plainto_tsquery('simple', ${query})) as fts_rank,
           similarity(d.search_text, ${query}) as trgm_sim,
           max(coalesce(1 - (c.embedding <=> ${qvec}::vector), 0)) as cos_sim,
           ts_rank(d.search_tsv, plainto_tsquery('simple', ${query}))
             + similarity(d.search_text, ${query})
             + max(coalesce(1 - (c.embedding <=> ${qvec}::vector), 0)) as score
    from reference_docs d
    left join reference_doc_chunks c on c.doc_id = d.id
    where d.status = 'approved'
      ${opts.productId ? sql`and d.product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and d.team_id = ${opts.teamId}` : sql``}
      ${opts.tags && opts.tags.length ? sql`and d.tags && ${opts.tags}` : sql``}
    group by d.id
    order by score desc
    limit ${limit}
  `;
}
