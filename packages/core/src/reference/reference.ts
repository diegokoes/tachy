import { sql } from "../infra/db";
import { chunkText } from "../search/chunk";
import {
  embedPassages,
  embedQuery,
  toVectorLiteral,
} from "../search/embeddings";
import { notFound, conflict } from "../infra/errors";
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
  docVersion?: string;
  supersedes?: string;
}

export interface ReferenceDocUpdate {
  title?: string;
  body?: string;
  tags?: string[];
  status?: string;
  source?: string | null;
  structured?: Record<string, unknown>;
  docVersion?: string | null;
  expectedVersion?: number;
}

async function embedChunks(docId: string, body: string): Promise<number> {
  const chunks = chunkText(body);
  if (!chunks.length) return 0;
  const vectors = await embedPassages(chunks);
  const ordinals = chunks.map((_, i) => i);
  const literals = vectors.map(toVectorLiteral);
  await sql`
    insert into reference_doc_chunks (doc_id, ordinal, chunk_text, embedding)
    select ${docId}, u.ordinal, u.chunk_text, u.embedding::vector
    from unnest(${ordinals}::int[], ${chunks}::text[], ${literals}::text[])
      as u(ordinal, chunk_text, embedding)
  `;
  return chunks.length;
}

export async function saveReferenceDoc(i: ReferenceDocInput) {
  const structured = parseStructured(i.structured);
  let predecessor:
    | {
        id: string;
        product_id: string | null;
        team_id: string | null;
        tags: string[];
      }
    | undefined;
  if (i.supersedes) {
    const [row] = await sql`
      select id, product_id, team_id, tags from reference_docs where id = ${i.supersedes}
    `;
    if (!row) throw notFound(`Reference doc '${i.supersedes}' not found`);
    predecessor = row as typeof predecessor;
  }
  const doc = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into reference_docs
        (product_id, team_id, created_by, source, title, body, tags, status, structured, doc_version)
      values
        (${i.productId ?? predecessor?.product_id ?? null},
         ${i.teamId ?? predecessor?.team_id ?? null},
         ${i.createdById ?? null}, ${i.source ?? null},
         ${i.title}, ${i.body}, ${i.tags ?? predecessor?.tags ?? []},
         ${i.status ?? "approved"}, ${sql.json(structured as any)}, ${i.docVersion ?? null})
      returning id, status, version
    `;
    if (predecessor)
      await tx`
        update reference_docs
        set status = 'archived', superseded_by = ${row.id}
        where id = ${predecessor.id}
      `;
    return row;
  });
  const chunks = await embedChunks(doc.id, i.body);
  return {
    id: doc.id as string,
    status: doc.status as string,
    version: doc.version as number,
    chunks,
  };
}

export async function getReferenceDoc(id: string) {
  const [row] = await sql`
    select id, product_id, team_id, source, title, body, tags, status, structured,
           doc_version, superseded_by, version, created_at, updated_at
    from reference_docs where id = ${id}
  `;
  if (!row) throw notFound(`Reference doc '${id}' not found`);
  return row;
}

export async function referenceDocLineage(id: string) {
  await getReferenceDoc(id);
  return sql`
    with recursive fwd as (
      select id, superseded_by from reference_docs where id = ${id}
      union all
      select d.id, d.superseded_by
      from reference_docs d join fwd on d.id = fwd.superseded_by
    ),
    back as (
      select id from reference_docs where id = ${id}
      union all
      select d.id
      from reference_docs d join back on d.superseded_by = back.id
    )
    select d.id, d.title, d.doc_version, d.status, d.superseded_by, d.created_at, d.updated_at
    from reference_docs d
    where d.id in (select id from fwd union select id from back)
    order by d.created_at desc
  `;
}

export async function listReferenceDocs(
  opts: {
    status?: string;
    productId?: string;
    teamId?: string;
    tags?: string[];
    limit?: number;
  } = {},
) {
  const limit = opts.limit ?? 50;
  return sql`
    select id, product_id, team_id, source, title, tags, status, doc_version, superseded_by,
           version, created_at, updated_at
    from reference_docs
    where 1=1
      ${opts.status ? sql`and status     = ${opts.status}` : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and team_id    = ${opts.teamId}` : sql``}
      ${opts.tags && opts.tags.length ? sql`and tags && ${opts.tags}` : sql``}
    order by updated_at desc
    limit ${limit}
  `;
}

export async function updateReferenceDoc(
  id: string,
  patch: ReferenceDocUpdate,
) {
  const [current] = await sql`
    select title, body, tags, status, source, structured, doc_version, version
    from reference_docs where id = ${id}
  `;
  if (!current) throw notFound(`Reference doc '${id}' not found`);
  if (
    patch.expectedVersion != null &&
    current.version !== patch.expectedVersion
  ) {
    throw conflict(
      `Version conflict: expected ${patch.expectedVersion}, found ${current.version}`,
    );
  }

  const merged = {
    title: patch.title ?? current.title,
    body: "body" in patch ? (patch.body ?? "") : current.body,
    tags: patch.tags ?? current.tags,
    status: patch.status ?? current.status,
    source: "source" in patch ? patch.source : current.source,
    structured:
      "structured" in patch
        ? parseStructured(patch.structured)
        : current.structured,
    docVersion: "docVersion" in patch ? patch.docVersion : current.doc_version,
  };
  const bodyChanged = merged.body !== current.body;

  const [row] = await sql`
    update reference_docs set
      title       = ${merged.title},
      body        = ${merged.body},
      tags        = ${merged.tags ?? []},
      status      = ${merged.status},
      source      = ${merged.source ?? null},
      structured  = ${sql.json((merged.structured ?? {}) as any)},
      doc_version = ${merged.docVersion ?? null},
      version     = version + 1
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
  /** Also match docs with NO product/team (org-wide) when a scope filter is
   *  set — for agent consults, where global runbooks still apply. */
  includeUnscoped?: boolean;
  tags?: string[];
  limit?: number;
}

export async function searchReferenceDocs(
  query: string,
  opts: ReferenceSearchOptions = {},
) {
  const limit = opts.limit ?? 6;
  if (!query.trim()) return [];
  const qvec = toVectorLiteral(await embedQuery(query));
  return sql`
    select d.id, d.title, d.tags, d.product_id, d.team_id, d.status, d.doc_version, d.version, d.structured,
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
      ${opts.productId ? (opts.includeUnscoped ? sql`and (d.product_id = ${opts.productId} or d.product_id is null)` : sql`and d.product_id = ${opts.productId}`) : sql``}
      ${opts.teamId ? (opts.includeUnscoped ? sql`and (d.team_id = ${opts.teamId} or d.team_id is null)` : sql`and d.team_id = ${opts.teamId}`) : sql``}
      ${opts.tags && opts.tags.length ? sql`and d.tags && ${opts.tags}` : sql``}
    group by d.id
    order by score desc
    limit ${limit}
  `;
}
