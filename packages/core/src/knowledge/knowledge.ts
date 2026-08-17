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

export interface KnowledgeFacets {
  cloud?: string | null;
  resolutionClarity?: string | null;
  learningValue?: string | null;
  hiddenFix?: boolean | null;

  affectedVersion?: string | null;
  fixedVersion?: string | null;
}

export interface KnowledgeInput extends KnowledgeFacets {
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
  if (
    i.workItemId &&
    (productId == null || teamId == null || affectedVersion == null)
  ) {
    const [wi] =
      await sql`select product_id, team_id, observed_version from work_items where id = ${i.workItemId}`;
    if (wi) {
      productId ??= wi.product_id ?? null;
      teamId ??= wi.team_id ?? null;
      affectedVersion ??= wi.observed_version ?? null;
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

  const [row] = await sql`
    insert into knowledge_entries
      (work_item_id, product_id, team_id, created_by, status, issue_summary, symptoms, signals, tags,
       root_cause, resolution, resolution_pattern, component_id, product_area, confidence,
       cloud, resolution_clarity, learning_value, hidden_fix, affected_version, fixed_version,
       structured, embedding)
    values
      (${i.workItemId ?? null}, ${productId}, ${teamId}, ${i.createdById ?? null},
       ${i.status ?? "approved"}, ${i.issueSummary ?? null}, ${i.symptoms ?? []}, ${i.signals ?? []}, ${i.tags ?? []},
       ${i.rootCause ?? null}, ${i.resolution ?? null}, ${i.resolutionPattern ?? null}, ${componentId}, ${productArea},
       ${confidence}, ${i.cloud ?? null}, ${i.resolutionClarity ?? null}, ${i.learningValue ?? null}, ${i.hiddenFix ?? null},
       ${affectedVersion}, ${i.fixedVersion ?? null},
       ${sql.json(structured as any)}, ${embedding}::vector)
    returning id, status
  `;
  return row;
}

export interface SearchOptions {
  productId?: string;
  teamId?: string;
  /** Also match rows with NO product/team (org-wide) when a scope filter is
   *  set — for agent consults, where global lessons still apply. */
  includeUnscoped?: boolean;
  tags?: string[];
  componentId?: string;
  componentTags?: string[];
  cloud?: string;
  learningValue?: string;
  resolutionClarity?: string;
  affectedVersion?: string;
  fixedVersion?: string;
  limit?: number;
  /** Pre-embedded query, so a caller searching two surfaces embeds once. */
  queryVector?: string;
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
    ${opts.tags && opts.tags.length ? sql`and tags && ${opts.tags}` : sql``}
    ${opts.componentId ? sql`and (component_id = ${opts.componentId} or tags && ${opts.componentTags ?? []})` : sql``}
    ${opts.cloud ? sql`and cloud = ${opts.cloud}` : sql``}
    ${opts.learningValue ? sql`and learning_value = ${opts.learningValue}` : sql``}
    ${opts.resolutionClarity ? sql`and resolution_clarity = ${opts.resolutionClarity}` : sql``}
    ${opts.affectedVersion ? sql`and affected_version = ${opts.affectedVersion}` : sql``}
    ${opts.fixedVersion ? sql`and fixed_version = ${opts.fixedVersion}` : sql``}
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
    ${fusedCte()}
    select e.id, e.work_item_id, e.status, e.superseded_by, e.issue_summary, e.root_cause, e.resolution,
           e.resolution_pattern, e.component_id, e.product_area, e.confidence, e.cloud,
           e.resolution_clarity, e.learning_value, e.hidden_fix,
           e.affected_version, e.fixed_version,
           e.symptoms, e.signals, e.tags, e.structured, e.version, e.created_at, e.updated_at,
           f.cos_sim, f.fts_rank, f.trgm_sim, f.rrf
    from fused f
    join knowledge_entries e on e.id = f.id
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
    select id, work_item_id, product_id, team_id, status, superseded_by, issue_summary,
           symptoms, signals, tags, root_cause, resolution, resolution_pattern,
           component_id, product_area, confidence, cloud, resolution_clarity, learning_value, hidden_fix,
           affected_version, fixed_version,
           structured, version, created_at, updated_at
    from knowledge_entries where id = ${id}
  `;
  if (!row) throw notFound(`Knowledge entry '${id}' not found`);
  return row;
}

export async function listKnowledgeEntries(
  opts: {
    status?: string;
    productId?: string;
    teamId?: string;
    tags?: string[];
    componentId?: string;
    componentTags?: string[];
    cloud?: string;
    learningValue?: string;
    resolutionClarity?: string;
    affectedVersion?: string;
    fixedVersion?: string;
    limit?: number;
  } = {},
) {
  const limit = opts.limit ?? 50;
  return sql`
    select id, work_item_id, product_id, team_id, status, superseded_by, issue_summary,
           root_cause, resolution, resolution_pattern, component_id, product_area, confidence,
           cloud, resolution_clarity, learning_value, hidden_fix, affected_version, fixed_version,
           symptoms, signals, tags, version, created_at, updated_at
    from knowledge_entries
    where 1=1
      ${opts.status ? sql`and status     = ${opts.status}` : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId ? sql`and team_id    = ${opts.teamId}` : sql``}
      ${opts.tags && opts.tags.length ? sql`and tags && ${opts.tags}` : sql``}
      ${opts.componentId ? sql`and (component_id = ${opts.componentId} or tags && ${opts.componentTags ?? []})` : sql``}
      ${opts.cloud ? sql`and cloud = ${opts.cloud}` : sql``}
      ${opts.learningValue ? sql`and learning_value = ${opts.learningValue}` : sql``}
      ${opts.resolutionClarity ? sql`and resolution_clarity = ${opts.resolutionClarity}` : sql``}
      ${opts.affectedVersion ? sql`and affected_version = ${opts.affectedVersion}` : sql``}
      ${opts.fixedVersion ? sql`and fixed_version = ${opts.fixedVersion}` : sql``}
    order by updated_at desc
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

/**
 * The affected versions actually recorded, narrowed by product and component so
 * the filter only ever offers values that can return a row.
 */
export async function listAffectedVersions(
  opts: {
    productId?: string;
    componentId?: string;
    componentTags?: string[];
  } = {},
): Promise<{ version: string; count: number }[]> {
  const rows = await sql`
    select affected_version as version, count(*)::int as count
    from knowledge_entries
    where affected_version is not null and affected_version <> ''
      and status not in ('rejected', 'archived')
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.componentId ? sql`and (component_id = ${opts.componentId} or tags && ${opts.componentTags ?? []})` : sql``}
    group by affected_version
    order by count desc, affected_version desc
  `;
  return rows as unknown as { version: string; count: number }[];
}

export async function updateKnowledgeEntry(
  id: string,
  patch: KnowledgeUpdateInput,
) {
  const [current] = await sql`
    select product_id, status, superseded_by, issue_summary, root_cause, resolution, resolution_pattern,
           symptoms, signals, tags, component_id, product_area, confidence,
           cloud, resolution_clarity, learning_value, hidden_fix, affected_version, fixed_version,
           structured, version
    from knowledge_entries where id = ${id}
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
    learningValue:
      "learningValue" in patch ? patch.learningValue : current.learning_value,
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

  const [row] = await sql`
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
      superseded_by      = ${supersededBy},
      confidence         = ${merged.confidence ?? null},
      cloud              = ${merged.cloud ?? null},
      resolution_clarity = ${merged.resolutionClarity ?? null},
      learning_value     = ${merged.learningValue ?? null},
      hidden_fix         = ${merged.hiddenFix ?? null},
      affected_version   = ${merged.affectedVersion ?? null},
      fixed_version      = ${merged.fixedVersion ?? null},
      structured         = ${sql.json((merged.structured ?? {}) as any)},
      version            = version + 1
      ${contentChanged ? (vec ? sql`, embedding = ${vec}::vector` : sql`, embedding = null`) : sql``}
    where id = ${id} and version = ${current.version}
    returning id, status, version
  `;
  if (!row)
    throw conflict(
      `Version conflict: knowledge entry '${id}' was updated concurrently`,
    );
  return row;
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
