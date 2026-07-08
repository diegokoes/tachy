import { sql } from "../platform/db";
import { embedPassage, embedQuery, toVectorLiteral } from "../search/embeddings";
import { notFound, conflict, badInput } from "../platform/errors";
import { parseStructured } from "./structured";
import { resolveComponentStrict } from "../catalog/components";

// Low-cardinality, filterable facets promoted out of `structured` into real columns.
export interface KnowledgeFacets {
  cloud?: string | null;
  resolutionClarity?: string | null;
  learningValue?: string | null;
  hiddenFix?: boolean | null;
  // Optional, free-form (like cloud). affectedVersion seeds from the work
  // item's observed_version when omitted; fixedVersion is set on resolution.
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
  component?: string;  // slug or alias from the product's component glossary; product_area is derived from it
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
  component?: string | null;    // null clears the component AND the derived product_area
  supersededBy?: string | null; // link to the newer entry that replaces this one
  confidence?: string | null;
  tags?: string[];
  structured?: Record<string, unknown>;
  expectedVersion?: number;
}

async function resolvePatternDescription(slug: string | undefined): Promise<string> {
  if (!slug) return "";
  const [pattern] = await sql`select description from resolution_patterns where slug = ${slug}`;
  if (!pattern) {
    throw badInput(
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
  // When tied to a work item, inherit its product/team (and observed version →
  // affected_version) unless explicitly given — the agent already established
  // those at fetch time, no need to repeat them.
  let productId = i.productId ?? null;
  let teamId = i.teamId ?? null;
  let affectedVersion = i.affectedVersion ?? null;
  if (i.workItemId && (productId == null || teamId == null || affectedVersion == null)) {
    const [wi] = await sql`select product_id, team_id, observed_version from work_items where id = ${i.workItemId}`;
    if (wi) {
      productId ??= wi.product_id ?? null;
      teamId ??= wi.team_id ?? null;
      affectedVersion ??= wi.observed_version ?? null;
    }
  }

  // product_area is never accepted from the caller — it's derived from the
  // component hierarchy, so the taxonomy can't drift entry by entry.
  let componentId: string | null = null;
  let productArea: string | null = null;
  if (i.component) {
    if (!productId) throw badInput("component requires a product (pass product_slug or a work item mapped to one)");
    const resolved = await resolveComponentStrict(productId, i.component);
    componentId = resolved.id;
    productArea = resolved.path;
  }

  const confidence = i.confidence ? i.confidence.toLowerCase() : null;
  const structured = parseStructured(i.structured);
  const patternDescription = await resolvePatternDescription(i.resolutionPattern);
  const text = buildEmbedText(i, patternDescription);
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
  tags?: string[];   // array-overlap filter; entries must carry at least one of these tags
  componentId?: string;      // matches the FK link…
  componentTags?: string[];  // …OR legacy entries that only carry the component as a tag
  cloud?: string;
  learningValue?: string;
  resolutionClarity?: string;
  affectedVersion?: string;
  fixedVersion?: string;
  limit?: number;
}

// Hybrid search: semantic cosine (primary) blended with FTS + trigram. Each
// signal is bounded to 0..1 and weighted so an unbounded ts_rank can't dominate;
// a small floor drops near-zero noise so weak matches don't dilute the result.
export async function searchKnowledge(query: string, opts: SearchOptions = {}) {
  const limit = opts.limit ?? 8;
  if (!query.trim()) return [];
  const qvec = toVectorLiteral(await embedQuery(query));
  const rows = await sql`
    select * from (
      select id, work_item_id, status, superseded_by, issue_summary, root_cause, resolution,
             resolution_pattern, component_id, product_area, confidence, cloud, resolution_clarity, learning_value, hidden_fix,
             affected_version, fixed_version,
             symptoms, signals, tags, structured, version,
             least(ts_rank(search_tsv, plainto_tsquery('simple', ${query})), 1.0) as fts_rank,
             similarity(search_text, ${query}) as trgm_sim,
             greatest(coalesce(1 - (embedding <=> ${qvec}::vector), 0), 0) as cos_sim,
             1.0 * greatest(coalesce(1 - (embedding <=> ${qvec}::vector), 0), 0)
               + 0.5 * least(ts_rank(search_tsv, plainto_tsquery('simple', ${query})), 1.0)
               + 0.3 * similarity(search_text, ${query}) as score
      from knowledge_entries
      -- deprecated entries surface on purpose: a flagged stale lesson beats the
      -- LLM re-deriving it from scratch. Consumers must warn on status='deprecated'.
      where status in ('approved', 'deprecated')
        ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
        ${opts.teamId ? sql`and team_id = ${opts.teamId}` : sql``}
        ${opts.tags && opts.tags.length ? sql`and tags && ${opts.tags}` : sql``}
        ${opts.componentId ? sql`and (component_id = ${opts.componentId} or tags && ${opts.componentTags ?? []})` : sql``}
        ${opts.cloud ? sql`and cloud = ${opts.cloud}` : sql``}
        ${opts.learningValue ? sql`and learning_value = ${opts.learningValue}` : sql``}
        ${opts.resolutionClarity ? sql`and resolution_clarity = ${opts.resolutionClarity}` : sql``}
        ${opts.affectedVersion ? sql`and affected_version = ${opts.affectedVersion}` : sql``}
        ${opts.fixedVersion ? sql`and fixed_version = ${opts.fixedVersion}` : sql``}
    ) ranked
    where score > 0.02
    order by score desc
    limit ${limit}
  `;
  return rows;
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
    status?: string; productId?: string; teamId?: string; tags?: string[];
    componentId?: string; componentTags?: string[];
    cloud?: string; learningValue?: string; resolutionClarity?: string;
    affectedVersion?: string; fixedVersion?: string; limit?: number;
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
      ${opts.status    ? sql`and status     = ${opts.status}`    : sql``}
      ${opts.productId ? sql`and product_id = ${opts.productId}` : sql``}
      ${opts.teamId    ? sql`and team_id    = ${opts.teamId}`    : sql``}
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

// Distinct stored cloud values, most common first — the deployment's live
// environment vocabulary, so new entries reuse slugs instead of inventing them.
export async function listEnvironments(): Promise<{ cloud: string; count: number }[]> {
  const rows = await sql`
    select cloud, count(*)::int as count
    from knowledge_entries
    where cloud is not null and status not in ('rejected', 'archived')
    group by cloud
    order by count desc, cloud
  `;
  return rows as unknown as { cloud: string; count: number }[];
}

export async function updateKnowledgeEntry(id: string, patch: KnowledgeUpdateInput) {
  const [current] = await sql`
    select product_id, status, superseded_by, issue_summary, root_cause, resolution, resolution_pattern,
           symptoms, signals, tags, component_id, product_area, confidence,
           cloud, resolution_clarity, learning_value, hidden_fix, affected_version, fixed_version,
           structured, version
    from knowledge_entries where id = ${id}
  `;
  if (!current) throw notFound(`Knowledge entry '${id}' not found`);

  if (patch.expectedVersion != null && current.version !== patch.expectedVersion) {
    throw conflict(`Version conflict: expected ${patch.expectedVersion}, found ${current.version}`);
  }

  // component: null clears both the FK and the derived product_area; a slug
  // re-resolves strictly against the entry's product.
  let componentId: string | null = current.component_id;
  let productArea: string | null = current.product_area;
  if ('component' in patch) {
    if (patch.component == null) {
      componentId = null;
      productArea = null;
    } else {
      if (!current.product_id) throw badInput("component requires the entry to belong to a product");
      const resolved = await resolveComponentStrict(current.product_id, patch.component);
      componentId = resolved.id;
      productArea = resolved.path;
    }
  }

  let supersededBy: string | null = current.superseded_by;
  if ('supersededBy' in patch) {
    supersededBy = patch.supersededBy ?? null;
    if (supersededBy != null) {
      if (supersededBy === id) throw badInput("an entry cannot supersede itself");
      const [target] = await sql`select id from knowledge_entries where id = ${supersededBy}`;
      if (!target) throw badInput(`superseded_by target '${supersededBy}' not found`);
    }
  }

  const merged = {
    status:            patch.status                  ?? current.status,
    issueSummary:      'issueSummary'      in patch ? patch.issueSummary      : current.issue_summary,
    rootCause:         'rootCause'         in patch ? patch.rootCause         : current.root_cause,
    resolution:        'resolution'        in patch ? patch.resolution        : current.resolution,
    resolutionPattern: 'resolutionPattern' in patch ? patch.resolutionPattern : current.resolution_pattern,
    symptoms:          patch.symptoms                ?? current.symptoms,
    signals:           patch.signals                 ?? current.signals,
    tags:              patch.tags                    ?? current.tags,
    confidence:        'confidence'        in patch ? (patch.confidence?.toLowerCase() ?? null) : current.confidence,
    cloud:             'cloud'             in patch ? patch.cloud             : current.cloud,
    resolutionClarity: 'resolutionClarity' in patch ? patch.resolutionClarity : current.resolution_clarity,
    learningValue:     'learningValue'     in patch ? patch.learningValue     : current.learning_value,
    hiddenFix:         'hiddenFix'         in patch ? patch.hiddenFix         : current.hidden_fix,
    affectedVersion:   'affectedVersion'   in patch ? patch.affectedVersion   : current.affected_version,
    fixedVersion:      'fixedVersion'      in patch ? patch.fixedVersion      : current.fixed_version,
    structured:        'structured'        in patch ? parseStructured(patch.structured) : current.structured,
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
