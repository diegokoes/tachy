import {
  DEFAULT_CODE_EXTENSIONS,
  REPO_INDEX_STATUSES,
  SLUG_RE,
} from "@tachy/contract";
import type {
  Freshness,
  RepoCensus,
  RepoIndexStatus,
  RepoLineRow,
  RepoRow,
} from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";
import { badInput, notFound } from "../infra/errors";
import { getProductIdBySlug } from "../catalog/products";
import { getCustomerIdBySlug } from "../catalog/customers";
import { resolveComponentStrict } from "../catalog/components";
import { getSourceProject } from "../sources/projects";
import type { EntryScope } from "../access/permissions";
import { assertBranchName, assertRepoUrl, removeClone } from "./git";

export { DEFAULT_CODE_EXTENSIONS, REPO_INDEX_STATUSES };
export type { RepoIndexStatus, RepoRow, RepoLineRow, RepoCensus };

export interface RepoInput {
  slug: string;
  url: string;
  productSlug?: string;
  sourceSlug?: string;
  sourceProjectId?: string | null;
  componentSlug?: string | null;
  /** Set for a customer's own addon repo; null/absent means shared product code. */
  customerSlug?: string | null;
  defaultBranch?: string;
  /**
   * Branches indexed besides the default, such as an older release line. Absent
   * keeps the lines the repo already has; a list replaces them.
   */
  lines?: string[];
  config?: Record<string, unknown>;
}

export async function linkRepo(i: RepoInput) {
  if (!SLUG_RE.test(i.slug))
    throw badInput(
      `invalid repo slug '${i.slug}' (lowercase letters, digits, hyphens)`,
    );
  let productId = i.productSlug
    ? await getProductIdBySlug(i.productSlug)
    : null;
  let sourceSlug = i.sourceSlug ?? null;

  if (i.sourceProjectId) {
    const project = await getSourceProject(i.sourceProjectId);
    if (!project.product_id)
      throw badInput(
        `project '${project.external_key}' has no product, so it holds no code and no repos`,
      );
    if (productId && productId !== project.product_id)
      throw badInput(
        `repo product and project product disagree: project '${project.external_key}' belongs to '${project.product_slug}'`,
      );
    productId = project.product_id;
    sourceSlug = sourceSlug ?? project.source_slug;
  }

  if (sourceSlug) {
    const [conn] =
      await sql`select slug from source_connections where slug = ${sourceSlug}`;
    if (!conn) throw badInput(`Unknown source connection: ${sourceSlug}`);
  }

  let componentId: string | null = null;
  if (i.componentSlug) {
    if (!productId)
      throw badInput(
        "a repo needs a product to implement a component: pass product or a project",
      );
    componentId = (await resolveComponentStrict(productId, i.componentSlug)).id;
  }

  const customerId = i.customerSlug
    ? await getCustomerIdBySlug(i.customerSlug)
    : null;

  // Checked here as well as at the spawn: a value that cannot be cloned should
  // be refused in the form the operator typed it into, not on a later reindex.
  assertRepoUrl(i.url);
  const defaultBranch = assertBranchName(i.defaultBranch || "main");
  const extraLines = [...new Set(i.lines ?? [])]
    .map(assertBranchName)
    .filter((ref) => ref !== defaultBranch);

  const [previous] = await sql`
    select default_branch from repos where slug = ${i.slug}
  `;
  const [row] = await sql`
    insert into repos (slug, url, product_id, source_slug, source_project_id, component_id,
                       customer_id, default_branch, config)
    values (${i.slug}, ${i.url}, ${productId}, ${sourceSlug},
            ${i.sourceProjectId ?? null}, ${componentId}, ${customerId},
            ${defaultBranch}, ${jsonb(i.config ?? {})})
    on conflict (slug) do update set
      url = excluded.url,
      product_id = excluded.product_id,
      source_slug = excluded.source_slug,
      source_project_id = excluded.source_project_id,
      component_id = excluded.component_id,
      customer_id = excluded.customer_id,
      default_branch = excluded.default_branch,
      config = excluded.config
    returning id, slug, url, default_branch
  `;

  await sql`
    insert into repo_lines (repo_id, ref)
    select ${row.id}, unnest(${[defaultBranch, ...extraLines]}::text[])
    on conflict (repo_id, ref) do nothing
  `;
  const dropped = i.lines
    ? await sql`
        delete from repo_lines
        where repo_id = ${row.id} and ref <> all(${[defaultBranch, ...extraLines]}::text[])
        returning id
      `
    : previous && previous.default_branch !== defaultBranch
      ? await sql`
          delete from repo_lines
          where repo_id = ${row.id} and ref = ${previous.default_branch}
          returning id
        `
      : [];
  if (dropped.length) await collectOrphanChunks(row.id);
  return row;
}

/** Chunks of blobs no line holds any more. */
export async function collectOrphanChunks(repoId: string): Promise<number> {
  const rows = await sql`
    delete from code_blob_chunks c
    where c.repo_id = ${repoId}
      and not exists (
        select 1 from repo_line_files f
        where f.repo_id = c.repo_id and f.blob_sha = c.blob_sha
      )
    returning 1
  `;
  return rows.length;
}

/** The line on the repo's default branch, as `dl`, for a query over `repos r`. */
export const defaultLineJoin = () => sql`
  left join repo_lines dl on dl.repo_id = r.id and dl.ref = r.default_branch
`;

const repoSelect = () => sql`
  select r.id, r.slug, r.url, r.product_id, r.source_slug, r.source_project_id,
         r.component_id, r.customer_id, r.default_branch, r.config, r.created_at,
         p.slug as product_slug, c.slug as component_slug,
         cu.slug as customer_slug, sp.external_key as project_key,
         coalesce(dl.index_status, 'idle') as index_status,
         dl.indexed_commit, dl.index_error,
         coalesce(dl.file_count, 0) as file_count,
         coalesce(dl.chunk_count, 0) as chunk_count,
         dl.last_indexed_at,
         coalesce((
           select json_agg(json_build_object(
                    'id', l.id, 'ref', l.ref, 'version_label', l.version_label,
                    'index_status', l.index_status,
                    'indexed_commit', l.indexed_commit,
                    'indexing_commit', l.indexing_commit,
                    'index_error', l.index_error,
                    'file_count', l.file_count, 'chunk_count', l.chunk_count,
                    'last_indexed_at', l.last_indexed_at)
                  order by l.ref <> r.default_branch, l.ref)
           from repo_lines l where l.repo_id = r.id
         ), '[]'::json) as lines
  from repos r
  ${defaultLineJoin()}
  left join products p on p.id = r.product_id
  left join components c on c.id = r.component_id
  left join customers cu on cu.id = r.customer_id
  left join source_projects sp on sp.id = r.source_project_id
`;

export interface ListReposOptions {
  productId?: string;
  componentId?: string;
  sourceProjectId?: string;
  customerId?: string;
  /**
   * With a customer, also return the repos belonging to no customer. A question
   * about one customer's install is nearly always answered partly by the shared
   * product code their addon sits on, so excluding it is the wrong default.
   * Set false to see only what is theirs.
   */
  includeShared?: boolean;
}

export async function listRepos(
  opts: ListReposOptions = {},
): Promise<RepoRow[]> {
  const shared = opts.includeShared !== false;
  return sql<RepoRow[]>`
    ${repoSelect()}
    where 1=1
      ${opts.productId ? sql`and r.product_id = ${opts.productId}` : sql``}
      ${opts.componentId ? sql`and r.component_id = ${opts.componentId}` : sql``}
      ${opts.sourceProjectId ? sql`and r.source_project_id = ${opts.sourceProjectId}` : sql``}
      ${
        opts.customerId
          ? shared
            ? sql`and (r.customer_id = ${opts.customerId} or r.customer_id is null)`
            : sql`and r.customer_id = ${opts.customerId}`
          : sql``
      }
    order by r.slug
  `;
}

export async function getRepoBySlug(slug: string): Promise<RepoRow> {
  const [row] = await sql<RepoRow[]>`${repoSelect()} where r.slug = ${slug}`;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  return row;
}

/** The scope a caller must be able to edit to touch this repo. */
export async function repoScope(slug: string): Promise<EntryScope> {
  const [row] = await sql`
    select r.product_id, coalesce(p.team_id, sp.team_id) as team_id
    from repos r
    left join products p on p.id = r.product_id
    left join source_projects sp on sp.id = r.source_project_id
    where r.slug = ${slug}
  `;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  return { productId: row.product_id, teamId: row.team_id };
}

export interface RepoLine extends RepoLineRow {
  repo_id: string;
}

/** A tracked line of a repo; the default line when `ref` is omitted. */
export async function getRepoLine(
  slug: string,
  ref?: string,
): Promise<RepoLine> {
  const [row] = await sql<RepoLine[]>`
    select l.* from repo_lines l
    join repos r on r.id = l.repo_id
    where r.slug = ${slug} and l.ref = coalesce(${ref ?? null}, r.default_branch)
  `;
  if (!row)
    throw notFound(
      ref
        ? `Repo '${slug}' does not track '${ref}'`
        : `Repo '${slug}' not found`,
    );
  return row;
}

export async function updateLineStatus(
  lineId: string,
  patch: {
    indexStatus?: RepoIndexStatus;
    indexedCommit?: string | null;
    indexingCommit?: string | null;
    indexError?: string | null;
    versionLabel?: string | null;
    touchIndexedAt?: boolean;
  },
): Promise<void> {
  const keep = (v: unknown, column: string) =>
    v === undefined ? sql`${sql(column)}` : sql`${v as string | null}`;
  await sql`
    update repo_lines set
      index_status = ${keep(patch.indexStatus, "index_status")},
      indexed_commit = ${keep(patch.indexedCommit, "indexed_commit")},
      indexing_commit = ${keep(patch.indexingCommit, "indexing_commit")},
      index_error = ${keep(patch.indexError, "index_error")},
      version_label = ${keep(patch.versionLabel, "version_label")},
      last_indexed_at = ${patch.touchIndexedAt ? sql`now()` : sql`last_indexed_at`}
    where id = ${lineId}
  `;
}

/** Recount what a line holds; a blob shared by two of its paths counts once. */
export async function recountLine(lineId: string): Promise<void> {
  await sql`
    update repo_lines l set
      file_count = (select count(*) from repo_line_files f where f.line_id = l.id),
      chunk_count = (
        select count(*) from code_blob_chunks c
        where c.repo_id = l.repo_id
          and c.blob_sha in (select f.blob_sha from repo_line_files f where f.line_id = l.id)
      )
    where l.id = ${lineId}
  `;
}

export async function deleteRepo(slug: string): Promise<void> {
  const [row] = await sql`delete from repos where slug = ${slug} returning id`;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  await removeClone(slug);
}

/**
 * Lines stuck in a transient status after a process crash/restart. What they
 * had written stays searchable; the next reindex finishes the diff.
 */
export async function sweepInterruptedIndexes(): Promise<number> {
  const rows = await sql`
    update repo_lines
    set index_status = 'error', index_error = 'indexing interrupted (process restarted)'
    where index_status in ('cloning','indexing')
    returning id
  `;
  return rows.length;
}

/**
 * For the admin index: repos, and how many are not answering searches.
 * `oldest_indexed_at` is a Date here and an ISO string once serialised.
 */
export async function repoCensus(): Promise<
  Omit<RepoCensus, "oldest_indexed_at"> & { oldest_indexed_at: Date | null }
> {
  const [row] = await sql`
    select
      count(*)::int as repos,
      count(*) filter (where dl.index_status = 'error')::int as failing,
      count(*) filter (where dl.index_status = 'ready')::int as ready,
      count(*) filter (where dl.index_status in ('cloning','indexing'))::int as working,
      count(*) filter (where coalesce(dl.index_status, 'idle') = 'idle')::int as idle,
      count(*) filter (where r.component_id is null)::int as no_component,
      count(*) filter (where r.source_project_id is null)::int as no_project,
      count(*) filter (where dl.last_indexed_at is null)::int as never_indexed,
      coalesce(sum(dl.file_count), 0)::int as files,
      coalesce(sum(dl.chunk_count), 0)::int as chunks,
      min(dl.last_indexed_at) as oldest_indexed_at
    from repos r
    ${defaultLineJoin()}
  `;
  return row as Omit<RepoCensus, "oldest_indexed_at"> & {
    oldest_indexed_at: Date | null;
  };
}

/** Repos that are not answering searches, or are filed nowhere, by slug. */
export async function repoIssues(): Promise<Record<string, IssueList>> {
  const where = {
    "repos.failing": sql`dl.index_status = 'error'`,
    "repos.never_indexed": sql`dl.last_indexed_at is null and coalesce(dl.index_status, 'idle') <> 'error'`,
    "repos.no_component": sql`r.component_id is null`,
    "repos.no_project": sql`r.source_project_id is null`,
  };
  const lists = await Promise.all(
    Object.values(where).map(
      (cond) => sql`
        select r.slug as key, r.slug as label, count(*) over () as total
        from repos r ${defaultLineJoin()} where ${cond}
        order by r.slug limit ${ISSUE_ITEMS}
      `,
    ),
  );
  return Object.fromEntries(
    Object.keys(where).map((k, i) => [k, issueList(lists[i])]),
  );
}

/** When each repo's default line was last indexed, oldest first. */
export async function repoFreshness(): Promise<Freshness[]> {
  const rows = await sql<
    { slug: string; last: Date | null; error: string | null }[]
  >`
    select r.slug, dl.last_indexed_at as last, dl.index_error as error
    from repos r ${defaultLineJoin()}
    order by dl.last_indexed_at nulls first, r.slug
  `;
  return rows.map((r) => ({
    kind: "repo",
    key: r.slug,
    label: r.slug,
    last_at: r.last ? r.last.toISOString() : null,
    error: r.error,
  }));
}
