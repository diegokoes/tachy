import { SLUG_RE } from "@tachy/contract";
import { sql } from "../infra/db";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";
import { badInput, notFound } from "../infra/errors";
import { getProductIdBySlug } from "../catalog/products";
import { getCustomerIdBySlug } from "../catalog/customers";
import { resolveComponentStrict } from "../catalog/components";
import { getSourceProject } from "../sources/projects";
import type { EntryScope } from "../access/permissions";
import { assertBranchName, assertRepoUrl, removeClone } from "./git";

export const REPO_INDEX_STATUSES = [
  "idle",
  "cloning",
  "indexing",
  "ready",
  "error",
] as const;
export type RepoIndexStatus = (typeof REPO_INDEX_STATUSES)[number];

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
  config?: Record<string, unknown>;
}

export interface RepoRow {
  id: string;
  slug: string;
  url: string;
  product_id: string | null;
  product_slug: string | null;
  source_slug: string | null;
  source_project_id: string | null;
  project_key: string | null;
  component_id: string | null;
  component_slug: string | null;
  customer_id: string | null;
  customer_slug: string | null;
  default_branch: string;
  config: Record<string, unknown>;
  index_status: RepoIndexStatus;
  indexed_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
  created_at: string;
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
        `project '${project.external_key}' is a tracker: it holds no code, so no repos`,
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
  if (i.defaultBranch) assertBranchName(i.defaultBranch);

  const [row] = await sql`
    insert into repos (slug, url, product_id, source_slug, source_project_id, component_id,
                       customer_id, default_branch, config)
    values (${i.slug}, ${i.url}, ${productId}, ${sourceSlug},
            ${i.sourceProjectId ?? null}, ${componentId}, ${customerId},
            ${i.defaultBranch ?? "main"}, ${sql.json((i.config ?? {}) as any)})
    on conflict (slug) do update set
      url = excluded.url,
      product_id = excluded.product_id,
      source_slug = excluded.source_slug,
      source_project_id = excluded.source_project_id,
      component_id = excluded.component_id,
      customer_id = excluded.customer_id,
      default_branch = excluded.default_branch,
      config = excluded.config
    returning id, slug, url, default_branch, index_status
  `;
  return row;
}

const repoSelect = () => sql`
  select r.*, p.slug as product_slug, c.slug as component_slug,
         cu.slug as customer_slug, sp.external_key as project_key
  from repos r
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
  return (await sql`
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
  `) as unknown as RepoRow[];
}

export async function getRepoBySlug(slug: string): Promise<RepoRow> {
  const [row] = await sql`${repoSelect()} where r.slug = ${slug}`;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  return row as unknown as RepoRow;
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

export async function updateRepoStatus(
  slug: string,
  patch: {
    indexStatus?: string;
    indexedCommit?: string | null;
    indexError?: string | null;
    fileCount?: number;
    chunkCount?: number;
    touchIndexedAt?: boolean;
  },
): Promise<void> {
  await sql`
    update repos set
      index_status = coalesce(${patch.indexStatus ?? null}, index_status),
      indexed_commit = ${patch.indexedCommit === undefined ? sql`indexed_commit` : patch.indexedCommit},
      index_error = ${patch.indexError === undefined ? sql`index_error` : patch.indexError},
      file_count = coalesce(${patch.fileCount ?? null}, file_count),
      chunk_count = coalesce(${patch.chunkCount ?? null}, chunk_count),
      last_indexed_at = ${patch.touchIndexedAt ? sql`now()` : sql`last_indexed_at`}
    where slug = ${slug}
  `;
}

export async function deleteRepo(slug: string): Promise<void> {
  const [row] = await sql`delete from repos where slug = ${slug} returning id`;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  await removeClone(slug);
}

/** Rows stuck in a transient status after a process crash/restart. */
export async function sweepInterruptedIndexes(): Promise<number> {
  const rows = await sql`
    update repos
    set index_status = 'error', index_error = 'indexing interrupted (process restarted)'
    where index_status in ('cloning','indexing')
    returning slug
  `;
  return rows.length;
}

/** For the admin index: repos, and how many are not answering searches. */
export async function repoCensus() {
  const [row] = await sql`
    select
      count(*)::int as repos,
      count(*) filter (where index_status = 'error')::int as failing,
      count(*) filter (where index_status = 'ready')::int as ready,
      count(*) filter (where index_status in ('cloning','indexing'))::int as working,
      count(*) filter (where index_status = 'idle')::int as idle,
      count(*) filter (where component_id is null)::int as no_component,
      count(*) filter (where source_project_id is null)::int as no_project,
      count(*) filter (where last_indexed_at is null)::int as never_indexed,
      coalesce(sum(file_count), 0)::int as files,
      coalesce(sum(chunk_count), 0)::int as chunks,
      min(last_indexed_at) as oldest_indexed_at
    from repos
  `;
  return row as {
    repos: number;
    failing: number;
    ready: number;
    working: number;
    idle: number;
    no_component: number;
    no_project: number;
    never_indexed: number;
    files: number;
    chunks: number;
    oldest_indexed_at: Date | null;
  };
}

/** Repos that are not answering searches, or are filed nowhere, by slug. */
export async function repoIssues(): Promise<Record<string, IssueList>> {
  const where = {
    "repos.failing": sql`index_status = 'error'`,
    "repos.never_indexed": sql`last_indexed_at is null and index_status <> 'error'`,
    "repos.no_component": sql`component_id is null`,
    "repos.no_project": sql`source_project_id is null`,
  };
  const lists = await Promise.all(
    Object.values(where).map(
      (cond) => sql`
        select slug as key, slug as label, count(*) over () as total
        from repos where ${cond}
        order by slug limit ${ISSUE_ITEMS}
      `,
    ),
  );
  return Object.fromEntries(
    Object.keys(where).map((k, i) => [k, issueList(lists[i])]),
  );
}
