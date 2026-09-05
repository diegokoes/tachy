import { sql } from "../infra/db";
import {
  embedPassage,
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
import { parseStructured } from "./structured";
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
import { syncLinks } from "../library/links";

/**
 * The prose fields of an entry, where a [[wikilink]] can be written. The
 * structured fields are values rather than writing, so they are not scanned.
 */
const linkText = (rootCause?: string | null, resolution?: string | null) =>
  [rootCause ?? "", resolution ?? ""].join("\n");

/**
 * The columns a revision snapshot covers: everything an update can change. The
 * initial read and the update's RETURNING share it, so the before and after
 * snapshots are the same shape and a diff between them means something.
 */
const REVISION_COLUMNS = sql`
  product_id, status, superseded_by, issue_summary, root_cause, resolution,
  resolution_pattern, symptoms, signals, tags, component_id, product_area,
  confidence, customer_id, customer_unit_id, cloud, resolution_clarity,
  hidden_fix, affected_version, fixed_version, structured
`;

export interface KnowledgeFacets {
  cloud?: string | null;
  resolutionClarity?: string | null;
  hiddenFix?: boolean | null;

  affectedVersion?: string | null;
  fixedVersion?: string | null;
}

export interface KnowledgeInput extends KnowledgeFacets {
  /** Who created it and through which door; seeds the entry's first revision. */
  actor?: ActorRef;
  workItemId?: string | null;
  productId?: string | null;
  teamId?: string | null;
  /** Whose install this describes. Never inherited from the work item — see
   *  saveKnowledgeEntry. Absent/null means the lesson is general. */
  customerSlug?: string | null;
  /** Which part of their estate, by unit slug/alias. Needs customerSlug. */
  unit?: string | null;
  createdById?: string | null;
  status?: string;
  issueSummary?: string;
  symptoms?: string[];
  signals?: string[];
  rootCause?: string;
  resolution?: string;
  resolutionPattern?: string;
  component?: string;
  confidence?: string;
  tags?: string[];
  structured?: Record<string, unknown>;
}

export interface KnowledgeUpdateInput extends KnowledgeFacets {
  status?: string;
  issueSummary?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  resolutionPattern?: string | null;
  symptoms?: string[];
  signals?: string[];
  component?: string | null;
  customerSlug?: string | null;
  unit?: string | null;
  supersededBy?: string | null;
  confidence?: string | null;
  tags?: string[];
  structured?: Record<string, unknown>;
  expectedVersion?: number;
}

async function resolvePatternDescription(
  slug: string | undefined,
): Promise<string> {
  if (!slug) return "";
  const [pattern] =
    await sql`select description from resolution_patterns where slug = ${slug}`;
  if (!pattern) {
    throw badInput(
      `Unknown resolution_pattern '${slug}'. Call list_resolution_patterns to see existing ones, or add_resolution_pattern first.`,
    );
  }
  return pattern.description as string;
}

/**
 * Must stay in step with the generated search_text column: a field the vector
 * cannot see is only findable by exact words. `resolution` is the one that
 * matters — a query phrased as the fix ("restart the label cache service")
 * otherwise has no semantic representation at all.
 */
function buildEmbedText(
  i: {
    issueSummary?: string;
    symptoms?: string[];
    rootCause?: string;
    resolution?: string;
    signals?: string[];
    tags?: string[];
  },
  patternDescription: string,
  productArea?: string | null,
): string {
  return [
    i.issueSummary,
    (i.symptoms ?? []).join(" "),
    i.rootCause,
    i.resolution,
    patternDescription,
    productArea,
    (i.signals ?? []).join(" "),
    (i.tags ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export async function saveKnowledgeEntry(i: KnowledgeInput) {
  let productId = i.productId ?? null;
  let teamId = i.teamId ?? null;
  let affectedVersion = i.affectedVersion ?? null;
  /*
   * Deliberately NOT inherited from the work item, unlike product and team.
   * Most lessons learned on one customer's ticket are true of the product, and a
   * customer defaulted in is a claim nobody made: it narrows the entry's ranking
   * and makes every future answer cite it as that customer's case. Whose ticket
   * it was is a fact; whose behaviour it describes is a judgement, so it has to
   * be stated.
   */
  const customerId = i.customerSlug
    ? await getCustomerIdBySlug(i.customerSlug)
    : null;
  /*
   * The UNIT, by contrast, IS inherited — but only once the customer above has
   * been stated and matches the ticket's. That keeps the rule intact: the
   * judgement "this entry is about ITG" is still made by a person, and saying
   * "…on the line the ticket was already filed against" adds no claim the
   * ticket did not record. Without a stated customer, nothing is inherited.
   */
  if (i.unit && !customerId)
    throw badInput(
      "a unit needs its customer — pass customer_slug alongside unit",
    );
  let customerUnitId: string | null =
    i.unit && customerId ? (await resolveUnit(customerId, i.unit)).id : null;
  if (
    i.workItemId &&
    (productId == null ||
      teamId == null ||
      affectedVersion == null ||
      (customerId != null && customerUnitId == null))
  ) {
    const [wi] =
      await sql`select product_id, team_id, customer_id, customer_unit_id, observed_version
                from work_items where id = ${i.workItemId}`;
    if (wi) {
      productId ??= wi.product_id ?? null;
      teamId ??= wi.team_id ?? null;
      affectedVersion ??= wi.observed_version ?? null;
      if (customerId != null && customerId === wi.customer_id)
        customerUnitId ??= wi.customer_unit_id ?? null;
    }
  }

  let componentId: string | null = null;
  let productArea: string | null = null;
  if (i.component) {
    if (!productId)
      throw badInput(
        "component requires a product (pass product_slug or a work item mapped to one)",
      );
    const resolved = await resolveComponentStrict(productId, i.component);
    componentId = resolved.id;
    productArea = resolved.path;
  }

  const confidence = i.confidence ? i.confidence.toLowerCase() : null;
  const structured = parseStructured(i.structured);
  const patternDescription = await resolvePatternDescription(
    i.resolutionPattern,
  );
  const text = buildEmbedText(i, patternDescription, productArea);
  const embedding = text ? toVectorLiteral(await embedPassage(text)) : null;

  return sql.begin(async (tx) => {
    const [row] = await tx`
      insert into knowledge_entries
        (work_item_id, product_id, team_id, customer_id, customer_unit_id, created_by, status,
         issue_summary, symptoms, signals, tags,
         root_cause, resolution, resolution_pattern, component_id, product_area, confidence,
         cloud, resolution_clarity, hidden_fix, affected_version, fixed_version,
         structured, embedding)
      values
        (${i.workItemId ?? null}, ${productId}, ${teamId}, ${customerId ?? null},
         ${customerUnitId}, ${i.createdById ?? null},
         ${i.status ?? "approved"}, ${i.issueSummary ?? null}, ${i.symptoms ?? []}, ${i.signals ?? []}, ${i.tags ?? []},
         ${i.rootCause ?? null}, ${i.resolution ?? null}, ${i.resolutionPattern ?? null}, ${componentId}, ${productArea},
         ${confidence}, ${i.cloud ?? null}, ${i.resolutionClarity ?? null}, ${i.hiddenFix ?? null},
         ${affectedVersion}, ${i.fixedVersion ?? null},
         ${sql.json(structured as any)}, ${embedding}::vector)
      returning id, version, ${REVISION_COLUMNS}
    `;
    await syncLinks(
      tx,
      { entryId: row.id as string },
      linkText(i.rootCause, i.resolution),
      productId,
    );
    // Version 1, so history is complete for everything created from here on.
    await recordRevision(
      tx,
      { entryId: row.id as string },
      row.version as number,
      i.actor ?? { ...UNKNOWN_ACTOR, userId: i.createdById ?? null },
      snapshotOf(row),
      [],
    );
    return { id: row.id as string, status: row.status as string };
  });
}

/**
 * The low-cardinality facets an entry can be NARROWED BY. Shared verbatim by
 * search, list and the facet counts, so a filter the library offers can never
 * be one the query ignores. Distinct from `KnowledgeFacets` above, which is the
 * write side: same columns, but set rather than matched.
 */
export interface KnowledgeFilters {
  tags?: string[];
  componentId?: string;
  componentTags?: string[];
  customerId?: string;
  cloud?: string;
  confidence?: string;
  resolutionClarity?: string;
  resolutionPattern?: string;
  hiddenFix?: boolean;
  affectedVersion?: string;
  fixedVersion?: string;
}

/** Facet keys, as the API and the library name them. */
export type FacetKey =
  | "tags"
  | "component"
  | "customer"
  | "cloud"
  | "confidence"
  | "resolution_clarity"
  | "resolution_pattern"
  | "hidden_fix"
  | "affected_version"
  | "fixed_version";

/**
 * `except` drops one predicate, so counting a facet's own options is not
 * narrowed by the value already chosen for it — otherwise picking "high"
 * leaves "high" as the only option you could ever pick again.
 */
function facetSql(o: KnowledgeFilters, except?: FacetKey) {
  const on = (k: FacetKey) => k !== except;
  return sql`
    ${o.tags && o.tags.length && on("tags") ? sql`and tags && ${o.tags}` : sql``}
    ${o.componentId && on("component") ? sql`and (component_id = ${o.componentId} or tags && ${o.componentTags ?? []})` : sql``}
    ${o.customerId && on("customer") ? sql`and customer_id = ${o.customerId}` : sql``}
    ${o.cloud && on("cloud") ? sql`and cloud = ${o.cloud}` : sql``}
    ${o.confidence && on("confidence") ? sql`and confidence = ${o.confidence}` : sql``}
    ${o.resolutionClarity && on("resolution_clarity") ? sql`and resolution_clarity = ${o.resolutionClarity}` : sql``}
    ${o.resolutionPattern && on("resolution_pattern") ? sql`and resolution_pattern = ${o.resolutionPattern}` : sql``}
    ${o.hiddenFix != null && on("hidden_fix") ? sql`and coalesce(hidden_fix, false) = ${o.hiddenFix}` : sql``}
    ${o.affectedVersion && on("affected_version") ? sql`and affected_version = ${o.affectedVersion}` : sql``}
    ${o.fixedVersion && on("fixed_version") ? sql`and fixed_version = ${o.fixedVersion}` : sql``}
  `;
}

export interface SearchOptions extends KnowledgeFilters {
  productId?: string;
  teamId?: string;
  /** Also match rows with NO product/team (org-wide) when a scope filter is
   *  set — for agent consults, where global lessons still apply. */
  includeUnscoped?: boolean;
  limit?: number;
  /** Pre-embedded query, so a caller searching two surfaces embeds once. */
  queryVector?: string;
  /**
   * Rank this customer's entries above equally-relevant general ones, without
   * excluding anything. Distinct from `customerId`, which narrows to them — the
   * cross-customer lesson is frequently the one that solves the ticket.
   */
  boostCustomerId?: string;
  /** Lifts this unit's own entries, and a sibling on the same shared profile
   *  less. Only meaningful alongside boostCustomerId. */
  boostUnitId?: string | null;
}

export async function searchKnowledge(query: string, opts: SearchOptions = {}) {
  const limit = clampLimit(opts.limit, 8);
  if (!query.trim()) return [];
  const qvec = opts.queryVector ?? (await embedQueryLiteral(query));

  // deprecated entries surface on purpose: a flagged stale lesson beats the
  // LLM re-deriving it from scratch. Consumers must warn on status='deprecated'.
  const filters = sql`
    status in ('approved', 'deprecated')
    ${opts.productId ? (opts.includeUnscoped ? sql`and (product_id = ${opts.productId} or product_id is null)` : sql`and product_id = ${opts.productId}`) : sql``}
    ${opts.teamId ? (opts.includeUnscoped ? sql`and (team_id = ${opts.teamId} or team_id is null)` : sql`and team_id = ${opts.teamId}`) : sql``}
    ${facetSql(opts)}
  `;

  const rows = await withSearchSession(
    (tx) => tx`
    with
    -- Each leg generates its own candidates through its own index, so a query
    -- that matches nothing on every leg returns nothing at all.
    vec as (
      select id,
             row_number() over (order by embedding <=> ${qvec}::vector) as rnk,
             1 - (embedding <=> ${qvec}::vector) as cos_sim
      from knowledge_entries
      where ${filters} and embedding is not null
        and 1 - (embedding <=> ${qvec}::vector) >= ${SEM_FLOOR}
      order by embedding <=> ${qvec}::vector
      limit ${CANDIDATES}
    ),
    lex as (
      select id,
             row_number() over (order by ${ftsRank(sql`search_tsv`, sql`search_tsv_en`, query)} desc) as rnk,
             ${ftsRank(sql`search_tsv`, sql`search_tsv_en`, query)} as fts_rank
      from knowledge_entries
      where ${filters} and ${ftsMatch(sql`search_tsv`, sql`search_tsv_en`, query)}
      order by ${ftsRank(sql`search_tsv`, sql`search_tsv_en`, query)} desc
      limit ${CANDIDATES}
    ),
    fuzzy as (
      select id,
             row_number() over (order by word_similarity(${query}, search_text) desc) as rnk,
             word_similarity(${query}, search_text) as trgm_sim
      from knowledge_entries
      where ${filters} and ${query} <% search_text
      order by word_similarity(${query}, search_text) desc
      limit ${CANDIDATES}
    ),
    ${fusedCte(
      opts.boostCustomerId
        ? {
            table: "knowledge_entries",
            customerId: opts.boostCustomerId,
            unitId: opts.boostUnitId ?? null,
          }
        : null,
    )}
    select e.id, e.work_item_id, e.status, e.superseded_by, e.issue_summary, e.root_cause, e.resolution,
           e.resolution_pattern, e.component_id, e.product_area, e.confidence, e.cloud,
           e.customer_id, cu.slug as customer_slug,
           e.resolution_clarity, e.hidden_fix,
           e.affected_version, e.fixed_version,
           e.symptoms, e.signals, e.tags, e.structured, e.version, e.created_at, e.updated_at,
           f.cos_sim, f.fts_rank, f.trgm_sim, f.rrf
    from fused f
    join knowledge_entries e on e.id = f.id
    left join customers cu on cu.id = e.customer_id
    order by f.rrf desc, e.updated_at desc
    limit ${limit}
  `,
  );
  return (rows as unknown as Parameters<typeof withRelevance>[0][]).map(
    withRelevance,
  );
}

export async function getKnowledgeEntry(id: string) {
  const [row] = await sql`
    select e.id, e.work_item_id, e.product_id, e.team_id, e.status, e.superseded_by, e.issue_summary,
           e.symptoms, e.signals, e.tags, e.root_cause, e.resolution, e.resolution_pattern,
           e.component_id, e.product_area, e.confidence, e.cloud, e.resolution_clarity,
           e.hidden_fix, e.affected_version, e.fixed_version,
           e.customer_id, cu.slug as customer_slug,
           e.customer_unit_id, un.slug as customer_unit_slug,
           e.structured, e.version, e.created_at, e.updated_at
    from knowledge_entries e
    left join customers cu on cu.id = e.customer_id
    left join customer_units un on un.id = e.customer_unit_id
    where e.id = ${id}
  `;
  if (!row) throw notFound(`Knowledge entry '${id}' not found`);
  return row;
}

export interface KnowledgeListOptions extends KnowledgeFilters {
  status?: string;
  productId?: string;
  teamId?: string;
  limit?: number;
}

export async function listKnowledgeEntries(opts: KnowledgeListOptions = {}) {
  const limit = clampLimit(opts.limit, 50);
  return sql`
    select e.id, e.work_item_id, e.product_id, e.team_id, e.status, e.superseded_by, e.issue_summary,
           e.root_cause, e.resolution, e.resolution_pattern, e.component_id, e.product_area, e.confidence,
           e.cloud, e.resolution_clarity, e.hidden_fix, e.affected_version, e.fixed_version,
           e.customer_id, cu.slug as customer_slug,
           e.symptoms, e.signals, e.tags, e.version, e.created_at, e.updated_at
    from knowledge_entries e
    left join customers cu on cu.id = e.customer_id
    where 1=1
      ${opts.status ? sql`and e.status     = ${opts.status}` : sql``}
      ${opts.productId ? sql`and e.product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and e.team_id    = ${opts.teamId}` : sql``}
      ${facetSql(opts)}
    order by e.updated_at desc
    limit ${limit}
  `;
}

export async function listEnvironments(): Promise<
  { cloud: string; count: number }[]
> {
  const rows = await sql`
    select cloud, count(*)::int as count
    from knowledge_entries
    where cloud is not null and status not in ('rejected', 'archived')
    group by cloud
    order by count desc, cloud
  `;
  return rows as unknown as { cloud: string; count: number }[];
}

export type FacetCount = { value: string; count: number };

/**
 * What each facet could still be narrowed to, counted under the filters
 * currently in force — so the library never offers a value with no rows behind
 * it. A facet is counted with its own selection lifted (see `facetSql`), which
 * is what keeps its other options reachable once one is picked.
 */
export async function listKnowledgeFacets(
  opts: KnowledgeListOptions = {},
): Promise<Record<FacetKey, FacetCount[]>> {
  const scope = (except: FacetKey) => sql`
    where 1=1
      ${opts.status ? sql`and status = ${opts.status}` : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and team_id = ${opts.teamId}` : sql``}
      ${facetSql(opts, except)}
  `;

  /** Every column facet counts the same way; only the column differs. */
  const column = async (key: FacetKey, col: string): Promise<FacetCount[]> => {
    const rows = await sql`
      select ${sql.unsafe(col)}::text as value, count(*)::int as count
      from knowledge_entries
      ${scope(key)}
        and ${sql.unsafe(col)} is not null
        and ${sql.unsafe(col)}::text <> ''
      group by 1
      order by count desc, value
    `;
    return rows as unknown as FacetCount[];
  };

  const tagRows = async (): Promise<FacetCount[]> => {
    const rows = await sql`
      select tag as value, count(*)::int as count
      from knowledge_entries, unnest(tags) as tag
      ${scope("tags")}
      group by tag
      order by count desc, tag
    `;
    return rows as unknown as FacetCount[];
  };

  /** Counted by slug, not id — that is what the filter and the URL carry. */
  const customerRows = async (): Promise<FacetCount[]> => {
    const rows = await sql`
      select cu.slug as value, count(*)::int as count
      from knowledge_entries
      join customers cu on cu.id = knowledge_entries.customer_id
      ${scope("customer")}
      group by cu.slug
      order by count desc, value
    `;
    return rows as unknown as FacetCount[];
  };

  const [
    tags,
    customer,
    cloud,
    confidence,
    resolution_clarity,
    resolution_pattern,
    hidden_fix,
    affected_version,
    fixed_version,
  ] = await Promise.all([
    tagRows(),
    customerRows(),
    column("cloud", "cloud"),
    column("confidence", "confidence"),
    column("resolution_clarity", "resolution_clarity"),
    column("resolution_pattern", "resolution_pattern"),
    column("hidden_fix", "hidden_fix"),
    column("affected_version", "affected_version"),
    column("fixed_version", "fixed_version"),
  ]);

  return {
    tags,
    // Components are their own catalogue with a hierarchy; the picker reads
    // that from /products/:slug/components rather than from row counts.
    component: [],
    customer,
    cloud,
    confidence,
    resolution_clarity,
    resolution_pattern,
    hidden_fix,
    affected_version,
    fixed_version,
  };
}

export async function updateKnowledgeEntry(
  id: string,
  patch: KnowledgeUpdateInput,
  actor: ActorRef = UNKNOWN_ACTOR,
) {
  const [current] = await sql`
    select ${REVISION_COLUMNS}, version from knowledge_entries where id = ${id}
  `;
  if (!current) throw notFound(`Knowledge entry '${id}' not found`);

  if (
    patch.expectedVersion != null &&
    current.version !== patch.expectedVersion
  ) {
    throw conflict(
      `Version conflict: expected ${patch.expectedVersion}, found ${current.version}`,
    );
  }

  let componentId: string | null = current.component_id;
  let productArea: string | null = current.product_area;
  if ("component" in patch) {
    if (patch.component == null) {
      componentId = null;
      productArea = null;
    } else {
      if (!current.product_id)
        throw badInput("component requires the entry to belong to a product");
      const resolved = await resolveComponentStrict(
        current.product_id,
        patch.component,
      );
      componentId = resolved.id;
      productArea = resolved.path;
    }
  }

  // Same rule as component: null makes the lesson general again.
  const customerId =
    "customerSlug" in patch
      ? patch.customerSlug
        ? await getCustomerIdBySlug(patch.customerSlug)
        : null
      : current.customer_id;

  /*
   * The unit follows the customer: re-filing an entry under a different customer
   * (or clearing it) cannot leave behind a unit belonging to the old one, which
   * would then resolve facts from an estate the entry is no longer about.
   */
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

  let supersededBy: string | null = current.superseded_by;
  if ("supersededBy" in patch) {
    supersededBy = patch.supersededBy ?? null;
    if (supersededBy != null) {
      if (supersededBy === id)
        throw badInput("an entry cannot supersede itself");
      const [target] =
        await sql`select id from knowledge_entries where id = ${supersededBy}`;
      if (!target)
        throw badInput(`superseded_by target '${supersededBy}' not found`);
    }
  }

  const merged = {
    status: patch.status ?? current.status,
    issueSummary:
      "issueSummary" in patch ? patch.issueSummary : current.issue_summary,
    rootCause: "rootCause" in patch ? patch.rootCause : current.root_cause,
    resolution: "resolution" in patch ? patch.resolution : current.resolution,
    resolutionPattern:
      "resolutionPattern" in patch
        ? patch.resolutionPattern
        : current.resolution_pattern,
    symptoms: patch.symptoms ?? current.symptoms,
    signals: patch.signals ?? current.signals,
    tags: patch.tags ?? current.tags,
    confidence:
      "confidence" in patch
        ? (patch.confidence?.toLowerCase() ?? null)
        : current.confidence,
    cloud: "cloud" in patch ? patch.cloud : current.cloud,
    resolutionClarity:
      "resolutionClarity" in patch
        ? patch.resolutionClarity
        : current.resolution_clarity,
    hiddenFix: "hiddenFix" in patch ? patch.hiddenFix : current.hidden_fix,
    affectedVersion:
      "affectedVersion" in patch
        ? patch.affectedVersion
        : current.affected_version,
    fixedVersion:
      "fixedVersion" in patch ? patch.fixedVersion : current.fixed_version,
    structured:
      "structured" in patch
        ? parseStructured(patch.structured)
        : current.structured,
  };

  const contentChanged =
    merged.issueSummary !== current.issue_summary ||
    merged.rootCause !== current.root_cause ||
    merged.resolution !== current.resolution ||
    merged.resolutionPattern !== current.resolution_pattern ||
    productArea !== current.product_area ||
    (merged.symptoms ?? []).join("\0") !==
      (current.symptoms ?? []).join("\0") ||
    (merged.tags ?? []).join("\0") !== (current.tags ?? []).join("\0") ||
    (merged.signals ?? []).join("\0") !== (current.signals ?? []).join("\0");

  let vec: string | null = null;
  if (contentChanged) {
    const patternDescription = await resolvePatternDescription(
      merged.resolutionPattern ?? undefined,
    );
    const text = buildEmbedText(
      {
        issueSummary: merged.issueSummary ?? undefined,
        symptoms: merged.symptoms,
        rootCause: merged.rootCause ?? undefined,
        resolution: merged.resolution ?? undefined,
        signals: merged.signals,
        tags: merged.tags,
      },
      patternDescription,
      productArea,
    );
    vec = text ? toVectorLiteral(await embedPassage(text)) : null;
  }

  return sql.begin(async (tx) => {
    const [row] = await tx`
    update knowledge_entries set
      status             = ${merged.status},
      issue_summary      = ${merged.issueSummary ?? null},
      root_cause         = ${merged.rootCause ?? null},
      resolution         = ${merged.resolution ?? null},
      resolution_pattern = ${merged.resolutionPattern ?? null},
      symptoms           = ${merged.symptoms ?? []},
      signals            = ${merged.signals ?? []},
      tags               = ${merged.tags ?? []},
      component_id       = ${componentId},
      product_area       = ${productArea},
      customer_id        = ${customerId},
      customer_unit_id   = ${customerUnitId},
      superseded_by      = ${supersededBy},
      confidence         = ${merged.confidence ?? null},
      cloud              = ${merged.cloud ?? null},
      resolution_clarity = ${merged.resolutionClarity ?? null},
      hidden_fix         = ${merged.hiddenFix ?? null},
      affected_version   = ${merged.affectedVersion ?? null},
      fixed_version      = ${merged.fixedVersion ?? null},
      structured         = ${sql.json((merged.structured ?? {}) as any)},
      version            = version + 1
      ${contentChanged ? (vec ? sql`, embedding = ${vec}::vector` : sql`, embedding = null`) : sql``}
    where id = ${id} and version = ${current.version}
    returning id, version, ${REVISION_COLUMNS}
  `;
    if (!row)
      throw conflict(
        `Version conflict: knowledge entry '${id}' was updated concurrently`,
      );
    await syncLinks(
      tx,
      { entryId: id },
      linkText(merged.rootCause, merged.resolution),
      current.product_id,
    );
    const after = snapshotOf(row);
    await recordRevision(
      tx,
      { entryId: id },
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

/**
 * Embed knowledge entries. `all: true` re-embeds every row — needed after a
 * model change, since vectors from different models are not comparable and a
 * half-migrated table ranks nonsense above matches.
 */
export async function backfillEmbeddings(
  opts: { all?: boolean } = {},
): Promise<number> {
  const rows = await sql`
    select id, issue_summary, root_cause, resolution, resolution_pattern,
           product_area, symptoms, signals, tags
    from knowledge_entries
    ${opts.all ? sql`` : sql`where embedding is null`}
  `;

  const patternDescriptions = new Map<string, string>();
  const texts: string[] = [];
  const ids: string[] = [];
  for (const r of rows) {
    const key = r.resolution_pattern ?? "";
    if (!patternDescriptions.has(key))
      patternDescriptions.set(
        key,
        await resolvePatternDescription(r.resolution_pattern ?? undefined),
      );
    const text = buildEmbedText(
      {
        issueSummary: r.issue_summary,
        rootCause: r.root_cause,
        resolution: r.resolution,
        symptoms: r.symptoms,
        signals: r.signals,
        tags: r.tags,
      },
      patternDescriptions.get(key)!,
      r.product_area,
    );
    if (!text) continue;
    texts.push(text);
    ids.push(r.id);
  }
  if (!texts.length) return 0;

  const vectors = await embedPassages(texts);
  await sql`
    update knowledge_entries e set embedding = v.vec::vector
    from (select unnest(${ids}::uuid[]) as id,
                 unnest(${vectors.map(toVectorLiteral)}::text[]) as vec) v
    where e.id = v.id
  `;
  return ids.length;
}

/**
 * Restore an entry to what a past revision held. An ordinary edit, not a
 * rewrite: it advances the version and appends a revision of its own, so the
 * revert is itself part of the history.
 *
 * product_id and product_area are skipped — the first is not something an update
 * may change, the second is derived from the component at write time.
 */
export async function revertKnowledgeEntry(
  id: string,
  version: number,
  actor: ActorRef = UNKNOWN_ACTOR,
) {
  const { snapshot } = await getRevision({ entryId: id }, version);
  const s = snapshot as Record<string, any>;
  const patch: KnowledgeUpdateInput = {
    status: s.status,
    issueSummary: s.issue_summary,
    rootCause: s.root_cause,
    resolution: s.resolution,
    resolutionPattern: s.resolution_pattern,
    symptoms: s.symptoms ?? [],
    signals: s.signals ?? [],
    tags: s.tags ?? [],
    supersededBy: s.superseded_by,
    confidence: s.confidence,
    cloud: s.cloud,
    resolutionClarity: s.resolution_clarity,
    hiddenFix: s.hidden_fix,
    affectedVersion: s.affected_version,
    fixedVersion: s.fixed_version,
    structured: s.structured,
    // The snapshot holds ids; the patch speaks slugs, so both are looked up.
    component: s.component_id ? await slugOfComponent(s.component_id) : null,
    customerSlug: s.customer_id ? await slugOfCustomer(s.customer_id) : null,
  };
  return updateKnowledgeEntry(id, patch, actor);
}

async function slugOfComponent(componentId: string): Promise<string | null> {
  const [row] =
    await sql`select slug from components where id = ${componentId}`;
  return (row?.slug as string) ?? null;
}

async function slugOfCustomer(customerId: string): Promise<string | null> {
  const [row] = await sql`select slug from customers where id = ${customerId}`;
  return (row?.slug as string) ?? null;
}
