import type {
  CatalogCensus,
  LabelRow,
  ProductRow,
  TeamRow,
} from "@tachy/contract";
import { sql } from "../infra/db";
import { productTagRenameImpact, renameProductTag } from "./product-tags";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";
import { badInput, conflict, notFound } from "../infra/errors";
import { clearPermissionCache } from "../access/permissions";

export async function getProductIdBySlug(slug: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select id from products
    where slug = ${slug}
       or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slug}))
    limit 2
  `;
  if (!rows.length)
    throw badInput(
      `Unknown product '${slug}'. Call list_products or add_product first.`,
    );
  if (rows.length > 1)
    throw badInput(
      `Ambiguous product '${slug}': exists in multiple teams; use a unique alias or rename one of the products.`,
    );
  return rows[0].id;
}

export async function listTeams() {
  return sql<TeamRow[]>`select id, slug, name from teams order by name`;
}

export async function getTeamIdBySlug(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from teams where slug = ${slug}
  `;
  if (!row)
    throw badInput(
      `Unknown team '${slug}'. Call list_teams or add_team first.`,
    );
  return row.id;
}

export async function addTeam(slug: string, name: string) {
  const [row] = await sql`
    insert into teams (slug, name) values (${slug}, ${name})
    on conflict (slug) do update set name = excluded.name
    returning id, slug, name
  `;
  return row;
}

export async function updateTeam(
  currentSlug: string,
  patch: { name?: string; slug?: string },
) {
  const [current] =
    await sql`select id, slug, name from teams where slug = ${currentSlug}`;
  if (!current) throw notFound(`Team '${currentSlug}' not found`);
  try {
    const [row] = await sql`
      update teams set
        name = ${patch.name ?? current.name},
        slug = ${patch.slug ?? current.slug}
      where id = ${current.id}
      returning id, slug, name
    `;
    // Cached permission contexts hold team slugs, not ids.
    if (patch.slug && patch.slug !== current.slug) clearPermissionCache();
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw conflict(`slug '${patch.slug}' is already taken by another team`);
    throw e;
  }
}

export async function deleteTeam(slug: string) {
  const [team] = await sql`select id from teams where slug = ${slug}`;
  if (!team) throw notFound(`Team '${slug}' not found`);
  const [ref] =
    await sql`select count(*)::int as n from products where team_id = ${team.id}`;
  if (ref.n > 0)
    throw conflict(
      `team '${slug}' still owns ${ref.n} product(s) - delete or move them first`,
    );
  await sql`delete from teams where id = ${team.id}`;
  clearPermissionCache();
  return { deleted: true, slug };
}

export async function listProducts(teamSlug?: string) {
  return sql<ProductRow[]>`
    select p.id, p.slug, p.name, p.aliases, t.slug as team_slug, t.name as team_name
    from products p join teams t on t.id = p.team_id
    ${teamSlug ? sql`where t.slug = ${teamSlug}` : sql``}
    order by t.name, p.name
  `;
}

export async function addProduct(
  teamSlug: string,
  slug: string,
  name: string,
  aliases?: string[],
) {
  const [team] = await sql`select id from teams where slug = ${teamSlug}`;
  if (!team)
    throw badInput(
      `Unknown team '${teamSlug}'. Call list_teams or add_team first.`,
    );
  const [row] = await sql`
    insert into products (team_id, slug, name, aliases) values (${team.id}, ${slug}, ${name}, ${aliases ?? []})
    on conflict (team_id, slug) do update set name = excluded.name, aliases = excluded.aliases
    returning id, slug, name, aliases
  `;
  return row;
}

export async function updateProduct(
  productId: string,
  patch: {
    name?: string;
    aliases?: string[];
    slug?: string;
    teamSlug?: string;
  },
) {
  const [current] =
    await sql`select id, team_id, name, aliases, slug from products where id = ${productId}`;
  if (!current) throw notFound(`Product '${productId}' not found`);

  let teamId = current.team_id as string;
  if (patch.teamSlug) {
    const [team] =
      await sql`select id from teams where slug = ${patch.teamSlug}`;
    if (!team) throw badInput(`Unknown team '${patch.teamSlug}'.`);
    teamId = team.id as string;
  }
  const moving = teamId !== current.team_id;

  try {
    const [row] = await sql.begin(async (tx) => {
      const updated = await tx`
        update products set
          name    = ${patch.name ?? current.name},
          aliases = ${patch.aliases ?? current.aliases},
          slug    = ${patch.slug ?? current.slug},
          team_id = ${teamId}
        where id = ${productId}
        returning id, slug, name, aliases
      `;
      // source_projects carries team_id alongside product_id, so a product
      // that changes hands would otherwise leave its projects behind.
      if (moving)
        await tx`update source_projects set team_id = ${teamId} where product_id = ${productId}`;
      return updated;
    });
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw conflict(
        `slug '${patch.slug ?? current.slug}' is already used by another product in ${
          patch.teamSlug ? `team '${patch.teamSlug}'` : "this team"
        }`,
      );
    throw e;
  }
}

export async function deleteProduct(productId: string) {
  const [current] =
    await sql`select id, slug from products where id = ${productId}`;
  if (!current) throw notFound(`Product '${productId}' not found`);
  const [refs] = await sql`
    select
      (select count(*)::int from knowledge_entries where product_id = ${productId}) as entries,
      (select count(*)::int from work_items where product_id = ${productId}) as work_items,
      (select count(*)::int from reference_docs where product_id = ${productId}) as docs,
      (select count(*)::int from source_projects where product_id = ${productId}) as projects,
      (select count(*)::int from repos where product_id = ${productId}) as repos
  `;
  const parts = [
    refs.entries > 0 ? `${refs.entries} knowledge entr(y/ies)` : null,
    refs.work_items > 0 ? `${refs.work_items} work item(s)` : null,
    refs.docs > 0 ? `${refs.docs} reference doc(s)` : null,
    refs.projects > 0 ? `${refs.projects} source project(s)` : null,
    refs.repos > 0 ? `${refs.repos} repo(s)` : null,
  ].filter(Boolean);
  if (parts.length)
    throw conflict(
      `product '${current.slug}' is referenced by ${parts.join(", ")} - re-scope or delete those first (its components and labels would also be removed)`,
    );
  await sql`delete from products where id = ${productId}`;
  return { deleted: true, slug: current.slug };
}

export async function listLabels(productId: string) {
  return sql<
    LabelRow[]
  >`select id, slug, description from labels where product_id = ${productId} order by slug`;
}

export async function addLabel(
  productId: string,
  slug: string,
  description?: string,
) {
  const [row] = await sql`
    insert into labels (product_id, slug, description) values (${productId}, ${slug}, ${description ?? null})
    on conflict (product_id, slug) do update set description = coalesce(excluded.description, labels.description)
    returning id, slug, description
  `;
  return row;
}

export async function updateLabel(
  productId: string,
  slug: string,
  description: string | null,
) {
  const [row] = await sql`
    update labels set description = ${description}
    where product_id = ${productId} and slug = ${slug}
    returning id, slug, description
  `;
  if (!row) throw notFound(`Label '${slug}' not found for this product`);
  return row;
}

export function labelRenameImpact(productId: string, slug: string) {
  return productTagRenameImpact("labels", productId, slug);
}

export function renameLabel(
  productId: string,
  oldSlug: string,
  newSlug: string,
) {
  return renameProductTag("labels", productId, oldSlug, newSlug);
}

export async function deleteLabel(productId: string, slug: string) {
  const [row] = await sql`
    delete from labels where product_id = ${productId} and slug = ${slug} returning slug
  `;
  if (!row) throw notFound(`Label '${slug}' not found for this product`);
  return { deleted: true, slug };
}

/**
 * One row for the admin index: how much of each thing the catalog holds, and
 * how much of it is only half-filled-in.
 *
 * The description counts are not tidiness. A label or component with no
 * description is one the agent has nothing to match a question against, so it
 * is dead weight in the taxonomy rather than an incomplete row.
 */
export async function catalogCensus(): Promise<CatalogCensus> {
  const [row] = await sql<Omit<CatalogCensus, "components_by_product">[]>`
    select
      (select count(*)::int from teams) as teams,
      (select count(*)::int from products) as products,
      (select count(*)::int from components) as components,
      (select count(*)::int from labels) as labels,
      (select count(*)::int from resolution_patterns) as patterns,
      (select count(*)::int from customers) as customers,
      (select count(*)::int from teams t
        where not exists (select 1 from products p where p.team_id = t.id)) as teams_no_product,
      (select count(*)::int from products p
        where not exists (select 1 from components c where c.product_id = p.id))
        as products_no_component,
      (select count(*)::int from components where parent_id is null) as components_root,
      (select count(*)::int from components
        where description is null or description = '') as components_no_description,
      (select count(*)::int from labels
        where description is null or description = '') as labels_no_description,
      (select count(*)::int from resolution_patterns where description = '')
        as patterns_no_description,
      (select count(*)::int from customers where cardinality(email_domains) = 0)
        as customers_no_domains,
      (select count(*)::int from customer_units) as customer_units
  `;
  /* The shape of the tree, not just its size: which products carry it and
     which have a slug and nothing under it. */
  const perProduct = await sql<CatalogCensus["components_by_product"]>`
    select p.slug, p.name, count(c.id)::int as n
    from products p
    left join components c on c.product_id = p.id
    group by p.id, p.slug, p.name
    order by n desc, p.slug
  `;
  return { ...row, components_by_product: [...perProduct] };
}

/** The half-filled-in parts of the catalog, by name. */
export async function catalogIssues(): Promise<Record<string, IssueList>> {
  const lists = await Promise.all([
    sql`
      select t.slug as key, t.name as label, count(*) over () as total
      from teams t
      where not exists (select 1 from products p where p.team_id = t.id)
      order by t.name limit ${ISSUE_ITEMS}
    `,
    sql`
      select p.id as key, p.name as label, count(*) over () as total
      from products p
      where not exists (select 1 from components c where c.product_id = p.id)
      order by p.name limit ${ISSUE_ITEMS}
    `,
    sql`
      select c.id as key, p.name || ' › ' || c.name as label, count(*) over () as total
      from components c join products p on p.id = c.product_id
      where c.description is null or c.description = ''
      order by p.name, c.name limit ${ISSUE_ITEMS}
    `,
    sql`
      select id as key, slug as label, count(*) over () as total
      from labels where description is null or description = ''
      order by slug limit ${ISSUE_ITEMS}
    `,
    sql`
      select slug as key, slug as label, count(*) over () as total
      from resolution_patterns where description = ''
      order by slug limit ${ISSUE_ITEMS}
    `,
    sql`
      select slug as key, name as label, count(*) over () as total
      from customers where cardinality(email_domains) = 0
      order by name limit ${ISSUE_ITEMS}
    `,
  ]);
  const keys = [
    "teams.no_product",
    "products.no_component",
    "components.no_description",
    "labels.no_description",
    "patterns.no_description",
    "customers.no_domains",
  ];
  return Object.fromEntries(keys.map((k, i) => [k, issueList(lists[i])]));
}
