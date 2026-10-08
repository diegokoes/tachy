import type { CatalogCensus } from "@tachy/contract";
import { sql } from "../infra/db";
import { ISSUE_ITEMS, issueList, type IssueList } from "../infra/issues";

/**
 * One row for the admin index: how much of each thing the catalog holds, and
 * how much of it is half filled in. Descriptions are counted because a label or
 * component without one gives the agent nothing to match a question against.
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
  // The shape of the tree as well as its size: which products carry it and
  // which have a slug and nothing under it.
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
