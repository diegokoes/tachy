import { sql } from "../db";

export async function getProductIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from products where slug = ${slug}`;
  if (!row) throw new Error(`Unknown product '${slug}'. Call list_products or add_product first.`);
  return row.id as string;
}

export async function listTeams() {
  return sql`select id, slug, name from teams order by name`;
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
    select p.id, p.slug, p.name, t.slug as team_slug, t.name as team_name
    from products p join teams t on t.id = p.team_id
    ${teamSlug ? sql`where t.slug = ${teamSlug}` : sql``}
    order by t.name, p.name
  `;
}

export async function addProduct(teamSlug: string, slug: string, name: string) {
  const [team] = await sql`select id from teams where slug = ${teamSlug}`;
  if (!team) throw new Error(`Unknown team '${teamSlug}'. Call list_teams or add_team first.`);
  const [row] = await sql`
    insert into products (team_id, slug, name) values (${team.id}, ${slug}, ${name})
    on conflict (team_id, slug) do update set name = excluded.name
    returning id, slug, name
  `;
  return row;
}
