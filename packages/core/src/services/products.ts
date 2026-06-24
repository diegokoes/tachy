import { sql } from "../db";

// Resolve by exact slug OR a case-insensitive alias match, so naming variants
// ('tpd' / 'Tobacco Product Directive') all reach the same product.
export async function getProductIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`
    select id from products
    where slug = ${slug}
       or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slug}))
    limit 1
  `;
  if (!row) throw new Error(`Unknown product '${slug}'. Call list_products or add_product first.`);
  return row.id as string;
}

export async function listTeams() {
  return sql`select id, slug, name from teams order by name`;
}

export async function getTeamIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from teams where slug = ${slug}`;
  if (!row) throw new Error(`Unknown team '${slug}'. Call list_teams or add_team first.`);
  return row.id as string;
}

export async function addTeam(slug: string, name: string) {
  const [row] = await sql`
    insert into teams (slug, name) values (${slug}, ${name})
    on conflict (slug) do update set name = excluded.name
    returning id, slug, name
  `;
  return row;
}

export async function listProducts(teamSlug?: string) {
  return sql`
    select p.id, p.slug, p.name, p.aliases, t.slug as team_slug, t.name as team_name
    from products p join teams t on t.id = p.team_id
    ${teamSlug ? sql`where t.slug = ${teamSlug}` : sql``}
    order by t.name, p.name
  `;
}

export async function addProduct(teamSlug: string, slug: string, name: string, aliases?: string[]) {
  const [team] = await sql`select id from teams where slug = ${teamSlug}`;
  if (!team) throw new Error(`Unknown team '${teamSlug}'. Call list_teams or add_team first.`);
  const [row] = await sql`
    insert into products (team_id, slug, name, aliases) values (${team.id}, ${slug}, ${name}, ${aliases ?? []})
    on conflict (team_id, slug) do update set name = excluded.name, aliases = excluded.aliases
    returning id, slug, name, aliases
  `;
  return row;
}

// Optional per-product advisory tag vocabulary. NOT enforced against
// knowledge_entries.tags — it's a curated suggestion list a team can maintain.
export async function listLabels(productId: string) {
  return sql`select id, slug, description from labels where product_id = ${productId} order by slug`;
}

export async function addLabel(productId: string, slug: string, description?: string) {
  const [row] = await sql`
    insert into labels (product_id, slug, description) values (${productId}, ${slug}, ${description ?? null})
    on conflict (product_id, slug) do update set description = coalesce(excluded.description, labels.description)
    returning id, slug, description
  `;
  return row;
}
