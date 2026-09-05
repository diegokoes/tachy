import { SLUG_RE } from "@tachy/contract";
import type { TransactionSql } from "postgres";
import { sql } from "../infra/db";
import { chunkText } from "../search/chunk";
import {
  embedPassages,
  embedQueryLiteral,
  toVectorLiteral,
} from "../search/embeddings";
import {
  CANDIDATES,
  clampLimit,
  ftsMatch,
  ftsRank,
  fusedCte,
  withSearchSession,
} from "../search/rank";
import { SEM_FLOOR, withRelevance } from "../search/relevance";
import { notFound, conflict, badInput } from "../infra/errors";
import { resolveComponentStrict } from "../catalog/components";
import { getCustomerIdBySlug } from "../catalog/customers";
import { resolveUnit } from "../catalog/units";
import {
  changedFields,
  getRevision,
  recordRevision,
  snapshotOf,
  UNKNOWN_ACTOR,
} from "../library/revisions";
import type { ActorRef } from "../library/revisions";
import { relinkBySlug, syncLinks } from "../library/links";

/** Shared by the read and the RETURNING so before/after snapshots line up. */
const REVISION_COLUMNS = sql`
  title, body, tags, status, source, structured, doc_version,
  product_id, component_id, product_area, customer_id, customer_unit_id, kind, slug
`;

import { parseStructured } from "../knowledge/structured";

/**
 * Path segments an article slug may not take, because the wiki routes use them.
 * Checked here rather than in the API so the MCP write path cannot bypass it.
 */
export const RESERVED_ARTICLE_SLUGS = ["toc", "c", "coverage", "new"] as const;

export function assertArticleSlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw badInput(
      `Invalid article slug '${slug}' — lowercase letters, digits and hyphens only.`,
    );
  if ((RESERVED_ARTICLE_SLUGS as readonly string[]).includes(slug))
    throw badInput(
      `'${slug}' is reserved by the wiki's own routes; pick another slug.`,
    );
}

export interface ReferenceDocInput {
  /** Who authored it and through which door; seeds the doc's first revision. */
  actor?: ActorRef;
  productId?: string | null;
  teamId?: string | null;
  createdById?: string | null;
  source?: string;
  /** Project this came from, and the page path within it, for wiki imports. */
  sourceProjectId?: string | null;
  externalKey?: string | null;
  title: string;
  body: string;
  tags?: string[];
  status?: string;
  structured?: Record<string, unknown>;
  docVersion?: string | null;
  supersedes?: string;
  /** Component slug/alias, resolved within productId. Optional: a general
   *  product doc belongs to the product and to no single component. */
  component?: string | null;
  /** Whose install this documents. Absent/null = general to every customer. */
  customerSlug?: string | null;
  /** Which part of their estate, by unit slug/alias. Needs customerSlug. */
  unit?: string | null;
  /** 'wiki' makes it an article: addressed by slug, placed by categories. */
  kind?: string;
  /** Required for kind 'wiki'; ignored otherwise. */
  slug?: string | null;
}

export interface ReferenceDocUpdate {
  title?: string;
  body?: string;
  tags?: string[];
  status?: string;
  source?: string | null;
  structured?: Record<string, unknown>;
  docVersion?: string | null;
  component?: string | null;
  customerSlug?: string | null;
  unit?: string | null;
  slug?: string | null;
  expectedVersion?: number;
}

interface ChunkVectors {
  chunks: string[];
  ordinals: number[];
  literals: string[];
}

async function chunkVectors(body: string): Promise<ChunkVectors> {
  const chunks = chunkText(body);
  if (!chunks.length) return { chunks: [], ordinals: [], literals: [] };
  const vectors = await embedPassages(chunks);
  return {
    chunks,
    ordinals: chunks.map((_, i) => i),
    literals: vectors.map(toVectorLiteral),
  };
}

async function insertChunks(
  db: typeof sql | TransactionSql,
  docId: string,
  v: ChunkVectors,
): Promise<number> {
  if (!v.chunks.length) return 0;
  await db`
    insert into reference_doc_chunks (doc_id, ordinal, chunk_text, embedding)
    select ${docId}, u.ordinal, u.chunk_text, u.embedding::vector
    from unnest(${v.ordinals}::int[], ${v.chunks}::text[], ${v.literals}::text[])
      as u(ordinal, chunk_text, embedding)
  `;
  return v.chunks.length;
}

/**
 * The live doc for an imported page — an *Azure DevOps* wiki page — so a
 * re-import supersedes instead of duplicating. Nothing to do with kind='wiki',
 * which means an article authored here.
 */
async function currentImportedDocId(
  sourceProjectId: string,
  externalKey: string,
): Promise<string | undefined> {
  const [row] = await sql`
    select id from reference_docs
    where source_project_id = ${sourceProjectId} and external_key = ${externalKey}
      and status <> 'archived'
    order by created_at desc
    limit 1
  `;
  return row?.id as string | undefined;
}

/**
 * Component slugs resolve within a product, so naming one without a product is
 * ambiguous rather than merely incomplete — reject it instead of guessing.
 */
async function resolveDocComponent(
  productId: string | null,
  component: string | null | undefined,
): Promise<{ componentId: string | null; productArea: string | null }> {
  if (!component) return { componentId: null, productArea: null };
  if (!productId)
    throw badInput(
      "component requires a product (pass product_slug); a doc with no product cannot name one",
    );
  const resolved = await resolveComponentStrict(productId, component);
  return { componentId: resolved.id, productArea: resolved.path };
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
  const supersedes =
    i.supersedes ??
    (i.sourceProjectId && i.externalKey
      ? await currentImportedDocId(i.sourceProjectId, i.externalKey)
      : undefined);
  if (supersedes) {
    const [row] = await sql`
      select id, product_id, team_id, tags from reference_docs where id = ${supersedes}
    `;
    if (!row) throw notFound(`Reference doc '${supersedes}' not found`);
    predecessor = row as typeof predecessor;
  }
  const productId = i.productId ?? predecessor?.product_id ?? null;
  const { componentId, productArea } = await resolveDocComponent(
    productId,
    i.component,
  );
  const customerId = i.customerSlug
    ? await getCustomerIdBySlug(i.customerSlug)
    : null;
  if (i.unit && !customerId)
    throw badInput(
      "a unit needs its customer — pass customer_slug alongside unit",
    );
  const customerUnitId =
    i.unit && customerId ? (await resolveUnit(customerId, i.unit)).id : null;
  const kind = i.kind ?? "reference";
  if (kind === "wiki") {
    if (!i.slug) throw badInput("a wiki article needs a slug");
    assertArticleSlug(i.slug);
  }
  const vectors = await chunkVectors(i.body);
  const { doc, chunks } = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into reference_docs
        (product_id, team_id, created_by, source, source_project_id, external_key,
         component_id, product_area, customer_id, customer_unit_id, title, body, tags,
         status, structured, doc_version, kind, slug)
      values
        (${productId},
         ${i.teamId ?? predecessor?.team_id ?? null},
         ${i.createdById ?? null}, ${i.source ?? null},
         ${i.sourceProjectId ?? null}, ${i.externalKey ?? null},
         ${componentId}, ${productArea}, ${customerId}, ${customerUnitId},
         ${i.title}, ${i.body}, ${i.tags ?? predecessor?.tags ?? []},
         ${i.status ?? "approved"}, ${sql.json(structured as any)},
         ${i.docVersion ?? null}, ${kind}, ${kind === "wiki" ? (i.slug ?? null) : null})
      returning id, version, ${REVISION_COLUMNS}
    `;
    await recordRevision(
      tx,
      { docId: row.id as string },
      row.version as number,
      i.actor ?? { ...UNKNOWN_ACTOR, userId: i.createdById ?? null },
      snapshotOf(row),
      [],
    );
    if (predecessor)
      await tx`
        update reference_docs
        set status = 'archived', superseded_by = ${row.id}
        where id = ${predecessor.id}
      `;
    await syncLinks(tx, { docId: row.id as string }, i.body, productId);
    // Links written before this article existed were stored unresolved; now
    // that the slug is real, they stop being broken without another edit.
    if (kind === "wiki" && i.slug)
      await relinkBySlug(tx, i.slug, row.id as string, productId);
    const n = await insertChunks(tx, row.id, vectors);
    return { doc: row, chunks: n };
  });
  return {
    id: doc.id as string,
    status: doc.status as string,
    version: doc.version as number,
    chunks,
  };
}

export async function getReferenceDoc(id: string) {
  const [row] = await sql`
    select d.id, d.product_id, d.team_id, d.component_id, d.product_area, d.source,
           d.title, d.body, d.tags, d.status, d.structured, d.doc_version,
           d.superseded_by, d.version, d.customer_id, cu.slug as customer_slug,
           d.customer_unit_id, un.slug as customer_unit_slug,
           d.kind, d.slug, d.created_at, d.updated_at
    from reference_docs d
    left join customers cu on cu.id = d.customer_id
    left join customer_units un on un.id = d.customer_unit_id
    where d.id = ${id}
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
    componentId?: string;
    componentTags?: string[];
    customerId?: string;
    docVersion?: string;
    /**
     * Which shelf to list. Defaults to imported docs only: wiki articles have
     * their own navigation, and mixing them into the docs list is what the
     * `kind` column exists to prevent. Pass 'any' to list both.
     */
    kind?: string;
    limit?: number;
  } = {},
) {
  const limit = clampLimit(opts.limit, 50);
  const kind = opts.kind ?? "reference";
  return sql`
    select d.id, d.product_id, d.team_id, d.component_id, d.product_area, d.source,
           d.title, d.tags, d.status, d.doc_version, d.superseded_by,
           d.customer_id, cu.slug as customer_slug, d.kind, d.slug,
           d.version, d.created_at, d.updated_at, left(d.body, 400) as snippet
    from reference_docs d
    left join customers cu on cu.id = d.customer_id
    where 1=1
      ${kind === "any" ? sql`` : sql`and d.kind = ${kind}`}
      ${opts.status ? sql`and d.status     = ${opts.status}` : sql``}
      ${opts.productId ? sql`and d.product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and d.team_id    = ${opts.teamId}` : sql``}
      ${opts.componentId ? sql`and (d.component_id = ${opts.componentId} or d.tags && ${opts.componentTags ?? []})` : sql``}
      ${opts.customerId ? sql`and d.customer_id = ${opts.customerId}` : sql``}
      ${opts.docVersion ? sql`and d.doc_version = ${opts.docVersion}` : sql``}
      ${opts.tags && opts.tags.length ? sql`and d.tags && ${opts.tags}` : sql``}
    order by d.updated_at desc
    limit ${limit}
  `;
}

export async function updateReferenceDoc(
  id: string,
  patch: ReferenceDocUpdate,
  actor: ActorRef = UNKNOWN_ACTOR,
) {
  const [current] = await sql`
    select ${REVISION_COLUMNS}, version from reference_docs where id = ${id}
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
    // An article's slug is its address, so it can be changed but never cleared:
    // a null slug would make the article unreachable and orphan its links.
    slug: "slug" in patch && patch.slug ? patch.slug : current.slug,
  };
  if (current.kind === "wiki" && merged.slug) assertArticleSlug(merged.slug);
  // Passing component: null clears it; omitting it leaves the mapping alone.
  const { componentId, productArea } =
    "component" in patch
      ? await resolveDocComponent(current.product_id, patch.component)
      : {
          componentId: current.component_id,
          productArea: current.product_area,
        };
  // Same rule as component: null clears the customer, omitting it keeps it.
  const customerId =
    "customerSlug" in patch
      ? patch.customerSlug
        ? await getCustomerIdBySlug(patch.customerSlug)
        : null
      : current.customer_id;
  // Same rule as knowledge entries: a unit cannot outlive the customer it
  // belongs to, or it resolves facts from an estate this doc is not about.
  let customerUnitId: string | null =
    customerId === current.customer_id ? current.customer_unit_id : null;
  if ("unit" in patch) {
    if (patch.unit && !customerId)
      throw badInput(
        "a unit needs its customer — set customerSlug alongside unit",
      );
    customerUnitId =
      patch.unit && customerId
        ? (await resolveUnit(customerId, patch.unit)).id
        : null;
  }
  const bodyChanged = merged.body !== current.body;
  const vectors = bodyChanged ? await chunkVectors(merged.body) : undefined;

  return sql.begin(async (tx) => {
    const [row] = await tx`
      update reference_docs set
        title       = ${merged.title},
        body        = ${merged.body},
        tags        = ${merged.tags ?? []},
        status      = ${merged.status},
        source      = ${merged.source ?? null},
        structured  = ${sql.json((merged.structured ?? {}) as any)},
        doc_version = ${merged.docVersion ?? null},
        component_id = ${componentId},
        product_area = ${productArea},
        customer_id  = ${customerId},
        customer_unit_id = ${customerUnitId},
        slug         = ${merged.slug ?? null},
        version     = version + 1
      where id = ${id} and version = ${current.version}
      returning id, version, ${REVISION_COLUMNS}
    `;
    if (!row)
      throw conflict(
        `Version conflict: reference doc '${id}' was updated concurrently`,
      );
    if (vectors) {
      await tx`delete from reference_doc_chunks where doc_id = ${id}`;
      await insertChunks(tx, id, vectors);
    }
    await syncLinks(tx, { docId: id }, merged.body, current.product_id);
    if (current.kind === "wiki" && merged.slug)
      await relinkBySlug(tx, merged.slug, id, current.product_id);
    const after = snapshotOf(row);
    await recordRevision(
      tx,
      { docId: id },
      row.version as number,
      actor,
      after,
      changedFields(snapshotOf(current), after),
    );
    return {
      id: row.id as string,
      status: row.status as string,
      version: row.version as number,
    };
  });
}

export interface ReferenceSearchOptions {
  productId?: string;
  teamId?: string;
  /** Also match docs with NO product/team (org-wide) when a scope filter is
   *  set — for agent consults, where global runbooks still apply. */
  includeUnscoped?: boolean;
  tags?: string[];
  componentId?: string;
  componentTags?: string[];
  customerId?: string;
  docVersion?: string;
  limit?: number;
  /** Pre-embedded query, so a caller searching two surfaces embeds once. */
  queryVector?: string;
  /** Rank this customer's docs first without excluding the general ones. */
  boostCustomerId?: string;
  /**
   * Narrow to imported docs or to wiki articles. Unlike the list, search spans
   * BOTH by default: a curated article should be findable beside — and able to
   * outrank — the material it consolidates.
   */
  kind?: string;
}

export async function searchReferenceDocs(
  query: string,
  opts: ReferenceSearchOptions = {},
) {
  const limit = clampLimit(opts.limit, 6);
  if (!query.trim()) return [];
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));

  const filters = sql`
    d.status = 'approved'
    ${opts.kind ? sql`and d.kind = ${opts.kind}` : sql``}
    ${opts.productId ? (opts.includeUnscoped ? sql`and (d.product_id = ${opts.productId} or d.product_id is null)` : sql`and d.product_id = ${opts.productId}`) : sql``}
    ${opts.teamId ? (opts.includeUnscoped ? sql`and (d.team_id = ${opts.teamId} or d.team_id is null)` : sql`and d.team_id = ${opts.teamId}`) : sql``}
    ${opts.componentId ? sql`and (d.component_id = ${opts.componentId} or d.tags && ${opts.componentTags ?? []})` : sql``}
    ${opts.customerId ? sql`and d.customer_id = ${opts.customerId}` : sql``}
    ${opts.docVersion ? sql`and d.doc_version = ${opts.docVersion}` : sql``}
    ${opts.tags && opts.tags.length ? sql`and d.tags && ${opts.tags}` : sql``}
  `;

  const rows = await withSearchSession(
    (tx) => tx`
    with
    -- The vector leg is chunk-level and keyed back to the doc, so a long
    -- runbook is judged by its best passage rather than its average.
    chunk_hits as (
      select c.doc_id, c.chunk_text,
             1 - (c.embedding <=> ${qvec}::vector) as cos_sim
      from reference_doc_chunks c
      join reference_docs d on d.id = c.doc_id
      where ${filters} and c.embedding is not null
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
      from reference_docs d
      where ${filters} and ${ftsMatch(sql`d.search_tsv`, sql`d.search_tsv_en`, query)}
      order by ${ftsRank(sql`d.search_tsv`, sql`d.search_tsv_en`, query)} desc
      limit ${CANDIDATES}
    ),
    fuzzy as (
      select d.id,
             row_number() over (order by word_similarity(${query}, d.search_text) desc) as rnk,
             word_similarity(${query}, d.search_text) as trgm_sim
      from reference_docs d
      where ${filters} and ${query} <% d.search_text
      order by word_similarity(${query}, d.search_text) desc
      limit ${CANDIDATES}
    ),
    ${fusedCte(
      opts.boostCustomerId
        ? { table: "reference_docs", customerId: opts.boostCustomerId }
        : null,
    )}
    select d.id, d.title, d.tags, d.product_id, d.team_id, d.component_id, d.product_area,
           d.status, d.doc_version, d.version, d.structured, d.source, d.created_at, d.updated_at,
           d.customer_id, cu.slug as customer_slug, d.kind, d.slug,
           coalesce(b.snippet, left(d.body, 400)) as snippet,
           f.cos_sim, f.fts_rank, f.trgm_sim, f.rrf
    from fused f
    join reference_docs d on d.id = f.id
    left join customers cu on cu.id = d.customer_id
    left join best_chunk b on b.id = f.id
    order by f.rrf desc, d.updated_at desc
    limit ${limit}
  `,
  );
  return (rows as unknown as Parameters<typeof withRelevance>[0][]).map(
    withRelevance,
  );
}

/**
 * Re-embed reference chunks. `all: true` rebuilds every vector — required after
 * a model change, since vectors from two models share no space.
 */
export async function backfillReferenceEmbeddings(
  opts: { all?: boolean } = {},
): Promise<number> {
  const rows = await sql`
    select id, chunk_text from reference_doc_chunks
    ${opts.all ? sql`` : sql`where embedding is null`}
    order by doc_id, ordinal
  `;
  if (!rows.length) return 0;

  let n = 0;
  for (let i = 0; i < rows.length; i += 64) {
    const batch = rows.slice(i, i + 64);
    const vectors = await embedPassages(
      batch.map((r) => r.chunk_text as string),
    );
    await sql`
      update reference_doc_chunks c set embedding = v.vec::vector
      from (select unnest(${batch.map((r) => r.id as string)}::uuid[]) as id,
                   unnest(${vectors.map(toVectorLiteral)}::text[]) as vec) v
      where c.id = v.id
    `;
    n += batch.length;
  }
  return n;
}

/** Restore a doc to a past revision. Same discipline as knowledge: a new edit. */
export async function revertReferenceDoc(
  id: string,
  version: number,
  actor: ActorRef = UNKNOWN_ACTOR,
) {
  const { snapshot } = await getRevision({ docId: id }, version);
  const s = snapshot as Record<string, any>;
  const [comp] = s.component_id
    ? await sql`select slug from components where id = ${s.component_id}`
    : [];
  const [cust] = s.customer_id
    ? await sql`select slug from customers where id = ${s.customer_id}`
    : [];
  // Passed even when null: the revision records it, and leaving it out carried
  // the live unit forward instead of restoring the one being reverted to.
  const [unit] = s.customer_unit_id
    ? await sql`select slug from customer_units where id = ${s.customer_unit_id}`
    : [];
  return updateReferenceDoc(
    id,
    {
      title: s.title,
      body: s.body,
      tags: s.tags ?? [],
      status: s.status,
      source: s.source,
      structured: s.structured,
      docVersion: s.doc_version,
      component: (comp?.slug as string) ?? null,
      customerSlug: (cust?.slug as string) ?? null,
      unit: (unit?.slug as string) ?? null,
    },
    actor,
  );
}
