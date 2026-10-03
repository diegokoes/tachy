import type { ProductRow } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";

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
