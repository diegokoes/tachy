import { sql } from "../infra/db";
import { wouldCycle } from "../infra/hierarchy";
import { badInput, conflict, notFound } from "../infra/errors";

export interface WikiCategoryRow {
  id: string;
  product_id: string | null;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  ordinal: number;
}

export interface WikiCategoryInput {
  productId?: string | null;
  slug: string;
  name: string;
  parentSlug?: string | null;
  description?: string | null;
  ordinal?: number;
}

export interface WikiCategoryPatch {
  slug?: string;
  name?: string;
  parentSlug?: string | null;
  description?: string | null;
  ordinal?: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function assertCategorySlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw badInput(
      `Invalid category slug '${slug}' — lowercase letters, digits and hyphens only.`,
    );
}

/**
 * One wiki per product; `productId` null is the org-wide wiki. The scope is a
 * value rather than a table, so `is not distinct from` matches the null case
 * without a second query shape.
 */
const inScope = (productId: string | null) =>
  sql`product_id is not distinct from ${productId}`;

export async function listWikiCategories(
  productId: string | null,
): Promise<WikiCategoryRow[]> {
  return sql`
    select id, product_id, parent_id, slug, name, description, ordinal
    from wiki_categories
    where ${inScope(productId)}
    order by ordinal, name
  ` as Promise<WikiCategoryRow[]>;
}

export async function getWikiCategory(
  productId: string | null,
  slug: string,
): Promise<WikiCategoryRow> {
  const [row] = await sql`
    select id, product_id, parent_id, slug, name, description, ordinal
    from wiki_categories
    where ${inScope(productId)} and slug = ${slug}
  `;
  if (!row) throw notFound(`No wiki category '${slug}' in this wiki`);
  return row as WikiCategoryRow;
}

async function parentIdOf(
  productId: string | null,
  parentSlug: string | null | undefined,
): Promise<string | null> {
  if (!parentSlug) return null;
  return (await getWikiCategory(productId, parentSlug)).id;
}

export async function addWikiCategory(i: WikiCategoryInput) {
  assertCategorySlug(i.slug);
  const productId = i.productId ?? null;
  const parentId = await parentIdOf(productId, i.parentSlug);
  if (parentId) {
    const [existing] = await sql`
      select id from wiki_categories
      where product_id is not distinct from ${productId} and slug = ${i.slug}
    `;
    if (
      existing &&
      (await wouldCycle("wiki_categories", existing.id, parentId))
    )
      throw badInput(
        `'${i.parentSlug}' sits under '${i.slug}' — that would make a cycle`,
      );
  }

  const [row] = await sql`
    insert into wiki_categories (product_id, parent_id, slug, name, description, ordinal)
    values (${productId}, ${parentId}, ${i.slug}, ${i.name},
            ${i.description ?? null}, ${i.ordinal ?? 0})
    on conflict (product_id, slug) do update set
      name        = excluded.name,
      description = excluded.description,
      parent_id   = excluded.parent_id,
      ordinal     = excluded.ordinal
    returning id, slug, name
  `;
  return row;
}

export async function updateWikiCategory(
  productId: string | null,
  slug: string,
  patch: WikiCategoryPatch,
) {
  const current = await getWikiCategory(productId, slug);

  let parentId = current.parent_id;
  if ("parentSlug" in patch) {
    parentId = await parentIdOf(productId, patch.parentSlug);
    if (parentId === current.id)
      throw badInput(`'${slug}' cannot be its own parent`);
    // Walking up from the proposed parent must not arrive back here, or the
    // branch detaches into a ring the table of contents never terminates on.
    if (await wouldCycle("wiki_categories", current.id, parentId))
      throw badInput(
        `'${patch.parentSlug}' sits under '${slug}' — that would make a cycle`,
      );
  }

  if (patch.slug && patch.slug !== slug) assertCategorySlug(patch.slug);

  const [row] = await sql`
    update wiki_categories set
      slug        = ${patch.slug ?? current.slug},
      name        = ${patch.name ?? current.name},
      description = ${"description" in patch ? (patch.description ?? null) : current.description},
      parent_id   = ${parentId},
      ordinal     = ${patch.ordinal ?? current.ordinal}
    where id = ${current.id}
    returning id, slug, name
  `;
  return row;
}

/**
 * Children are re-parented onto the deleted category's own parent rather than
 * cascading, so removing a middle category flattens that branch instead of
 * deleting a subtree of work. Article memberships do cascade — an article is
 * not owned by its category.
 */
export async function deleteWikiCategory(
  productId: string | null,
  slug: string,
) {
  const current = await getWikiCategory(productId, slug);
  return sql.begin(async (tx) => {
    await tx`
      update wiki_categories set parent_id = ${current.parent_id}
      where parent_id = ${current.id}
    `;
    await tx`delete from wiki_categories where id = ${current.id}`;
    return { deleted: slug };
  });
}

export interface WikiArticleRef {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  ordinal: number;
  updated_at: string;
  /** Sources this was composed from that have changed since it was written. */
  stale?: number;
}

export interface WikiTocNode extends WikiCategoryRow {
  articles: WikiArticleRef[];
  children: WikiTocNode[];
}

export interface WikiToc {
  categories: WikiTocNode[];
  /** Articles filed under nothing — the wiki's own measure of unfiled work. */
  uncategorised: WikiArticleRef[];
}

/**
 * The general table of contents: the category tree with its articles. Generated
 * rather than curated, so it cannot go stale or forget a new article.
 */
export async function wikiToc(productId: string | null): Promise<WikiToc> {
  const [categories, members, loose, staleRows] = await Promise.all([
    listWikiCategories(productId),
    sql`
      select ac.category_id, d.id, d.slug, d.title, d.status, ac.ordinal, d.updated_at
      from wiki_article_categories ac
      join reference_docs d on d.id = ac.doc_id
      join wiki_categories c on c.id = ac.category_id
      where c.${sql("product_id")} is not distinct from ${productId}
        and d.kind = 'wiki' and d.status <> 'archived'
      order by ac.ordinal, d.title
    `,
    sql`
      select d.id, d.slug, d.title, d.status, 0 as ordinal, d.updated_at
      from reference_docs d
      where d.kind = 'wiki' and d.status <> 'archived'
        and d.product_id is not distinct from ${productId}
        and not exists (select 1 from wiki_article_categories ac where ac.doc_id = d.id)
      order by d.title
    `,
    // One aggregate rather than a staleness query per article: how many of the
    // things each page was built from have moved since it was written.
    sql`
      select l.from_doc_id as id, count(*)::int as stale
      from library_links l
      join reference_docs page on page.id = l.from_doc_id
      left join knowledge_entries e on e.id = l.to_entry_id
      left join reference_docs d    on d.id = l.to_doc_id
      where l.kind = 'composed_from'
        and page.product_id is not distinct from ${productId}
        and coalesce(e.updated_at, d.updated_at) > page.updated_at
      group by l.from_doc_id
    `,
  ]);

  const staleBy = new Map<string, number>();
  for (const r of staleRows as any[]) staleBy.set(r.id, r.stale);
  const withStale = (a: WikiArticleRef): WikiArticleRef => {
    const n = staleBy.get(a.id);
    return n ? { ...a, stale: n } : a;
  };

  const byCategory = new Map<string, WikiArticleRef[]>();
  for (const m of members as any[]) {
    const list = byCategory.get(m.category_id) ?? [];
    list.push(
      withStale({
        id: m.id,
        slug: m.slug,
        title: m.title,
        status: m.status,
        ordinal: m.ordinal,
        updated_at: m.updated_at,
      }),
    );
    byCategory.set(m.category_id, list);
  }

  const nodes = new Map<string, WikiTocNode>();
  for (const c of categories)
    nodes.set(c.id, {
      ...c,
      articles: byCategory.get(c.id) ?? [],
      children: [],
    });

  const roots: WikiTocNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return {
    categories: roots,
    uncategorised: (loose as unknown as WikiArticleRef[]).map(withStale),
  };
}

/** The categories an article is filed under, deepest path first for display. */
export async function articleCategories(
  docId: string,
): Promise<WikiCategoryRow[]> {
  return sql`
    select c.id, c.product_id, c.parent_id, c.slug, c.name, c.description, c.ordinal
    from wiki_article_categories ac
    join wiki_categories c on c.id = ac.category_id
    where ac.doc_id = ${docId}
    order by c.ordinal, c.name
  ` as Promise<WikiCategoryRow[]>;
}

/**
 * Replace an article's category memberships. Whole-set rather than add/remove:
 * the editor sends the list it wants, and a concurrent edit cannot leave a
 * half-applied membership behind.
 */
export async function setArticleCategories(
  productId: string | null,
  docId: string,
  slugs: string[],
): Promise<void> {
  const ids: string[] = [];
  for (const slug of slugs)
    ids.push((await getWikiCategory(productId, slug)).id);
  await sql.begin(async (tx) => {
    await tx`delete from wiki_article_categories where doc_id = ${docId}`;
    if (!ids.length) return;
    await tx`
      insert into wiki_article_categories (doc_id, category_id, ordinal)
      select ${docId}, id, ord
      from unnest(${ids}::uuid[]) with ordinality as u(id, ord)
      on conflict do nothing
    `;
  });
}

/**
 * An article by its slug within one wiki. One article per slug: there is no
 * per-version forking, and `doc_version` on the row is a label carried by
 * imported docs rather than something resolution keys on.
 */
export async function findArticle(productId: string | null, slug: string) {
  const [row] = await sql`
    select d.id, d.product_id, d.team_id, d.component_id, d.product_area, d.source,
           d.title, d.body, d.tags, d.status, d.structured, d.doc_version,
           d.version, d.customer_id, cu.slug as customer_slug, d.kind, d.slug,
           d.created_at, d.updated_at
    from reference_docs d
    left join customers cu on cu.id = d.customer_id
    where d.kind = 'wiki' and d.status <> 'archived'
      and d.product_id is not distinct from ${productId}
      and d.slug = ${slug}
    limit 1
  `;
  if (!row) throw notFound(`No wiki article '${slug}' in this wiki`);
  return row;
}

/** Every wiki that has anything in it, for the wiki index page. */
export async function listWikis() {
  return sql`
    select p.id as product_id, p.slug as product_slug, p.name as product_name,
           count(d.id)::int as articles
    from products p
    left join reference_docs d
      on d.product_id = p.id and d.kind = 'wiki' and d.status <> 'archived'
    group by p.id, p.slug, p.name
    union all
    select null, null, null,
           (select count(*)::int from reference_docs
            where kind = 'wiki' and status <> 'archived' and product_id is null)
    order by product_name nulls first
  `;
}

/**
 * The main page is a real article at a reserved slug, written like any other.
 * Returns null rather than throwing when it does not exist yet, so the route can
 * offer to create one instead of 404ing a wiki that is simply new.
 */
export const MAIN_PAGE_SLUG = "main";

export async function findMainPage(productId: string | null) {
  try {
    return await findArticle(productId, MAIN_PAGE_SLUG);
  } catch {
    return null;
  }
}

export { conflict };

export interface DraftSource {
  id: string;
  kind: "entry" | "doc";
  title: string;
  /** Enough of the substance to compose from, not the whole record. */
  body: string;
  component: string | null;
  updated_at: string;
}

/**
 * The material under one component, for an article to be written from. Walks
 * the component subtree, because "Printing" should draw on its children too —
 * a lesson recorded against a sub-component is still about printing.
 *
 * Returns the substance rather than ids: composing needs the text, and a second
 * round-trip per item would make drafting an article a dozen tool calls.
 */
export async function draftSources(
  productId: string,
  componentSlug: string,
  limit = 40,
): Promise<DraftSource[]> {
  const [root] = await sql`
    select id from components
    where product_id = ${productId} and slug = ${componentSlug}
  `;
  if (!root) throw notFound(`No component '${componentSlug}' in this product`);

  const rows = await sql`
    with recursive subtree as (
      select id from components where id = ${root.id}
      union all
      select c.id from components c join subtree s on c.parent_id = s.id
    )
    select e.id, 'entry' as kind,
           coalesce(e.issue_summary, '(no summary)') as title,
           concat_ws(E'\\n\\n',
             nullif(e.root_cause, ''),
             nullif(e.resolution, ''),
             nullif(array_to_string(e.symptoms, '; '), '')) as body,
           e.product_area as component, e.updated_at
    from knowledge_entries e
    where e.component_id in (select id from subtree)
      and e.status in ('approved', 'deprecated')
    union all
    select d.id, 'doc', d.title, left(d.body, 4000), d.product_area, d.updated_at
    from reference_docs d
    where d.component_id in (select id from subtree)
      and d.status = 'approved' and d.kind = 'reference'
    order by updated_at desc
    limit ${limit}
  `;
  return rows as unknown as DraftSource[];
}
