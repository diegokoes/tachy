import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";
import { getProductIdBySlug } from "../catalog/products";
import { removeClone } from "./git";

export interface RepoInput {
  slug: string;
  url: string;
  productSlug?: string;
  sourceSlug?: string;
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
  default_branch: string;
  config: Record<string, unknown>;
  index_status: string;
  indexed_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
  created_at: string;
}

export async function linkRepo(i: RepoInput) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(i.slug))
    throw badInput(
      `invalid repo slug '${i.slug}' (lowercase letters, digits, hyphens)`,
    );
  const productId = i.productSlug
    ? await getProductIdBySlug(i.productSlug)
    : null;
  if (i.sourceSlug) {
    const [conn] =
      await sql`select slug from source_connections where slug = ${i.sourceSlug}`;
    if (!conn) throw badInput(`Unknown source connection: ${i.sourceSlug}`);
  }
  const [row] = await sql`
    insert into repos (slug, url, product_id, source_slug, default_branch, config)
    values (${i.slug}, ${i.url}, ${productId}, ${i.sourceSlug ?? null},
            ${i.defaultBranch ?? "main"}, ${sql.json((i.config ?? {}) as any)})
    on conflict (slug) do update set
      url = excluded.url,
      product_id = excluded.product_id,
      source_slug = excluded.source_slug,
      default_branch = excluded.default_branch,
      config = excluded.config
    returning id, slug, url, default_branch, index_status
  `;
  return row;
}

export async function listRepos(): Promise<RepoRow[]> {
  return (await sql`
    select r.*, p.slug as product_slug
    from repos r left join products p on p.id = r.product_id
    order by r.slug
  `) as unknown as RepoRow[];
}

export async function getRepoBySlug(slug: string): Promise<RepoRow> {
  const [row] = await sql`
    select r.*, p.slug as product_slug
    from repos r left join products p on p.id = r.product_id
    where r.slug = ${slug}
  `;
  if (!row) throw notFound(`Repo '${slug}' not found`);
  return row as unknown as RepoRow;
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
