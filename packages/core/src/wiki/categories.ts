import { MAIN_PAGE_SLUG, SLUG_RE } from "@tachy/contract";
import { sql } from "../infra/db";
import { wouldCycle } from "../infra/hierarchy";
import { badInput, conflict, notFound } from "../infra/errors";
import { visibleGap } from "./gaps";
import type {
  WikiCategoryRow,
  WikiArticleRef,
  WikiTocNode,
  WikiToc,
  WikiListRow,
  WikiSearchHit,
} from "@tachy/contract";

export type { WikiCategoryRow, WikiArticleRef, WikiTocNode, WikiToc };

export interface WikiCategoryInput {
  productId?: string | null;
  slug: string;
  name: string;
  parentSlug?: string | null;
  description?: string | null;
  ordinal?: number;
  /** The section's lead article, by slug. */
  leadSlug?: string | null;
  /** Components this section covers, by slug. */
  componentSlugs?: string[];
}

export interface WikiCategoryPatch {
  slug?: string;
  name?: string;
  parentSlug?: string | null;
  description?: string | null;
  ordinal?: number;
  leadSlug?: string | null;
  componentSlugs?: string[];
}

function assertCategorySlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw badInput(
      `Invalid category slug '${slug}': lowercase letters, digits and hyphens only.`,
    );
}

/**
 * One wiki per product; `productId` null is the org-wide wiki. The scope is a
 * value rather than a table, so `is not distinct from` matches the null case
 * without a second query shape.
 */
const inScope = (productId: string | null) =>
  sql`product_id is not distinct from ${productId}`;

/**
 * One category shape everywhere: the row plus its lead article's slug/title and
 * the components it covers. The lateral aggregate keeps components as a single
 * jsonb array so a category is one row rather than a join to fan out and regroup.
 */
function categoryRows(productId: string | null, slug?: string) {
  return sql<WikiCategoryRow[]>`
    select c.id, c.product_id, c.parent_id, c.slug, c.name, c.description, c.ordinal,
           lead.slug as lead_slug, lead.title as lead_title,
           coalesce(comp.components, '[]'::jsonb) as components
    from wiki_categories c
    left join reference_docs lead
      on lead.id = c.lead_doc_id and lead.status <> 'archived'
    left join lateral (
      select jsonb_agg(jsonb_build_object('slug', cm.slug, 'name', cm.name)
                       order by cm.name) as components
      from wiki_category_components cc
      join components cm on cm.id = cc.component_id
      where cc.category_id = c.id
    ) comp on true
    where c.product_id is not distinct from ${productId}
      ${slug ? sql`and c.slug = ${slug}` : sql``}
    order by c.ordinal, c.name
  `;
}

export async function listWikiCategories(
  productId: string | null,
): Promise<WikiCategoryRow[]> {
  return categoryRows(productId);
}

export async function getWikiCategory(
  productId: string | null,
  slug: string,
): Promise<WikiCategoryRow> {
  const [row] = await categoryRows(productId, slug);
  if (!row) throw notFound(`No wiki category '${slug}' in this wiki`);
  return row;
}

/** The lead article's doc id, or null; throws if the slug names no article. */
async function leadDocId(
  productId: string | null,
  leadSlug: string | null | undefined,
): Promise<string | null> {
  if (!leadSlug) return null;
  return (await findArticle(productId, leadSlug)).id;
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
        `'${i.parentSlug}' sits under '${i.slug}'; that would make a cycle`,
      );
  }

  const lead = await leadDocId(productId, i.leadSlug);
  const [row] = await sql`
    insert into wiki_categories (product_id, parent_id, slug, name, description, ordinal, lead_doc_id)
    values (${productId}, ${parentId}, ${i.slug}, ${i.name},
            ${i.description ?? null}, ${i.ordinal ?? 0}, ${lead})
    on conflict (product_id, slug) do update set
      name        = excluded.name,
      description = excluded.description,
      parent_id   = excluded.parent_id,
      ordinal     = excluded.ordinal,
      -- On a re-add, only replace the lead when one was named; omitting it keeps
      -- what is there rather than clearing it.
      lead_doc_id = coalesce(excluded.lead_doc_id, wiki_categories.lead_doc_id)
    returning id, slug, name
  `;
  if (i.componentSlugs !== undefined)
    await setCategoryComponents(productId, row.id, i.componentSlugs);
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
        `'${patch.parentSlug}' sits under '${slug}'; that would make a cycle`,
      );
  }

  if (patch.slug && patch.slug !== slug) assertCategorySlug(patch.slug);

  const lead =
    "leadSlug" in patch
      ? await leadDocId(productId, patch.leadSlug)
      : undefined;

  const [row] = await sql`
    update wiki_categories set
      slug        = ${patch.slug ?? current.slug},
      name        = ${patch.name ?? current.name},
      description = ${"description" in patch ? (patch.description ?? null) : current.description},
      parent_id   = ${parentId},
      ordinal     = ${patch.ordinal ?? current.ordinal},
      lead_doc_id = ${lead === undefined ? sql`lead_doc_id` : lead}
    where id = ${current.id}
    returning id, slug, name
  `;
  if (patch.componentSlugs !== undefined)
    await setCategoryComponents(productId, current.id, patch.componentSlugs);
  return row;
}

/**
 * Replace a section's covered components. Whole-set, like article categories: the
 * editor sends the list it wants. Components belong to a product, so the org-wide
 * wiki has none to link and an empty list is the only valid input there.
 */
export async function setCategoryComponents(
  productId: string | null,
  categoryId: string,
  componentSlugs: string[],
): Promise<void> {
  const ids: string[] = [];
  for (const slug of componentSlugs) {
    const [c] = await sql`
      select id from components
      where product_id = ${productId} and slug = ${slug}
    `;
    if (!c) throw notFound(`No component '${slug}' in this product`);
    ids.push(c.id);
  }
  await sql.begin(async (tx) => {
    await tx`delete from wiki_category_components where category_id = ${categoryId}`;
    if (!ids.length) return;
    await tx`
      insert into wiki_category_components (category_id, component_id)
      select ${categoryId}, id from unnest(${ids}::uuid[]) as u(id)
      on conflict do nothing
    `;
  });
}

/**
 * Seed sections from the product's top-level components — the one-click start for
 * a new wiki. One section per top-level component, linked to it, appended after
 * any sections already there. Re-runnable: a slug that already exists is skipped,
 * so it never clobbers curation.
 */
export async function seedSectionsFromComponents(productId: string) {
  const tops = await sql<{ slug: string; name: string }[]>`
    select slug, name from components
    where product_id = ${productId} and parent_id is null
    order by name
  `;
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from wiki_categories
    where product_id is not distinct from ${productId} and parent_id is null
  `;
  let ordinal = n;
  const created: { slug: string; name: string }[] = [];
  for (const c of tops) {
    const [existing] = await sql`
      select 1 from wiki_categories
      where product_id is not distinct from ${productId} and slug = ${c.slug}
    `;
    if (existing) continue;
    await addWikiCategory({
      productId,
      slug: c.slug,
      name: c.name,
      ordinal: ordinal++,
      componentSlugs: [c.slug],
    });
    created.push({ slug: c.slug, name: c.name });
  }
  return { created };
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
 * imported docs rather than something resolution keys on. A slug the article
 * had before a rename still finds it; the row's own `slug` says where it lives.
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
      and (d.slug = ${slug} or d.id in (
        select a.doc_id from wiki_slug_aliases a
        where a.product_id is not distinct from ${productId} and a.slug = ${slug}))
    order by d.slug = ${slug} desc
    limit 1
  `;
  if (!row) throw notFound(`No wiki article '${slug}' in this wiki`);
  return row;
}

/**
 * In-wiki quick search for the Ctrl+K palette. Scoped to this one wiki and,
 * unlike the library's reference search, it includes drafts — a curator navigates
 * their own unfinished pages — and stays lightweight (title/slug/body match) since
 * it answers keystroke by keystroke.
 */
export async function searchWikiArticles(
  productId: string | null,
  q: string,
  limit = 20,
): Promise<WikiSearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return sql<WikiSearchHit[]>`
    select d.id, d.slug, d.title, d.status,
           left(regexp_replace(coalesce(d.body, ''), '\s+', ' ', 'g'), 200) as snippet
    from reference_docs d
    where d.kind = 'wiki' and d.status <> 'archived'
      and d.product_id is not distinct from ${productId}
      and (d.search_tsv_en @@ plainto_tsquery('english', ${term})
           or d.title ilike ${like} or d.slug ilike ${like})
    order by ts_rank(d.search_tsv_en, plainto_tsquery('english', ${term})) desc,
             d.updated_at desc
    limit ${limit}
  `;
}

/** Every wiki, with what it holds and what it is missing, for the switcher. */
export async function listWikis() {
  return sql<WikiListRow[]>`
    select p.id as product_id, p.slug as product_slug, p.name as product_name,
           (select count(*)::int from reference_docs d
             where d.product_id = p.id and d.kind = 'wiki'
               and d.status <> 'archived') as articles,
           (select count(*)::int from wiki_gaps g
             where g.product_id = p.id and ${visibleGap()}) as open_gaps
    from products p
    union all
    select null, null, null,
           (select count(*)::int from reference_docs
            where kind = 'wiki' and status <> 'archived' and product_id is null),
           (select count(*)::int from wiki_gaps g
             where g.product_id is null and ${visibleGap()})
    order by product_name nulls first
  `;
}

export { MAIN_PAGE_SLUG };

/**
 * Null rather than throwing when the main page does not exist yet, so the route
 * can offer to create one instead of 404ing a wiki that is simply new.
 */
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
