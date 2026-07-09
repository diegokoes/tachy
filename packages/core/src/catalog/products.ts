import { sql } from "../platform/db";
import { badInput, conflict, notFound } from "../platform/errors";



export async function getProductIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`
    select id from products
    where slug = ${slug}
       or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slug}))
    limit 1
  `;
  if (!row) throw badInput(`Unknown product '${slug}'. Call list_products or add_product first.`);
  return row.id as string;
}

export async function listTeams() {
  return sql`select id, slug, name from teams order by name`;
}

export async function getTeamIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from teams where slug = ${slug}`;
  if (!row) throw badInput(`Unknown team '${slug}'. Call list_teams or add_team first.`);
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




export async function updateTeam(currentSlug: string, patch: { name?: string; slug?: string }) {
  const [current] = await sql`select id, slug, name from teams where slug = ${currentSlug}`;
  if (!current) throw notFound(`Team '${currentSlug}' not found`);
  try {
    const [row] = await sql`
      update teams set
        name = ${patch.name ?? current.name},
        slug = ${patch.slug ?? current.slug}
      where id = ${current.id}
      returning id, slug, name
    `;
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
  const [ref] = await sql`select count(*)::int as n from products where team_id = ${team.id}`;
  if (ref.n > 0)
    throw conflict(`team '${slug}' still owns ${ref.n} product(s) - delete or move them first`);
  await sql`delete from teams where id = ${team.id}`;
  return { deleted: true, slug };
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
  if (!team) throw badInput(`Unknown team '${teamSlug}'. Call list_teams or add_team first.`);
  const [row] = await sql`
    insert into products (team_id, slug, name, aliases) values (${team.id}, ${slug}, ${name}, ${aliases ?? []})
    on conflict (team_id, slug) do update set name = excluded.name, aliases = excluded.aliases
    returning id, slug, name, aliases
  `;
  return row;
}



export async function updateProduct(productId: string, patch: { name?: string; aliases?: string[]; slug?: string }) {
  const [current] = await sql`select id, name, aliases, slug from products where id = ${productId}`;
  if (!current) throw notFound(`Product '${productId}' not found`);
  try {
    const [row] = await sql`
      update products set
        name    = ${patch.name ?? current.name},
        aliases = ${patch.aliases ?? current.aliases},
        slug    = ${patch.slug ?? current.slug}
      where id = ${productId}
      returning id, slug, name, aliases
    `;
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw conflict(`slug '${patch.slug}' is already used by another product in this team`);
    throw e;
  }
}



export async function deleteProduct(productId: string) {
  const [current] = await sql`select id, slug from products where id = ${productId}`;
  if (!current) throw notFound(`Product '${productId}' not found`);
  const [refs] = await sql`
    select
      (select count(*)::int from knowledge_entries where product_id = ${productId}) as entries,
      (select count(*)::int from work_items where product_id = ${productId}) as work_items,
      (select count(*)::int from reference_docs where product_id = ${productId}) as docs
  `;
  const parts = [
    refs.entries > 0 ? `${refs.entries} knowledge entr(y/ies)` : null,
    refs.work_items > 0 ? `${refs.work_items} work item(s)` : null,
    refs.docs > 0 ? `${refs.docs} reference doc(s)` : null,
  ].filter(Boolean);
  if (parts.length)
    throw conflict(`product '${current.slug}' is referenced by ${parts.join(", ")} - re-scope or delete those first (its components and labels would also be removed)`);
  await sql`delete from products where id = ${productId}`;
  return { deleted: true, slug: current.slug };
}



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

export async function updateLabel(productId: string, slug: string, description: string | null) {
  const [row] = await sql`
    update labels set description = ${description}
    where product_id = ${productId} and slug = ${slug}
    returning id, slug, description
  `;
  if (!row) throw notFound(`Label '${slug}' not found for this product`);
  return row;
}



export async function labelRenameImpact(productId: string, slug: string): Promise<{ entries: number; docs: number }> {
  const [current] = await sql`select id from labels where product_id = ${productId} and slug = ${slug}`;
  if (!current) throw notFound(`Label '${slug}' not found for this product`);
  const [e] = await sql`select count(*)::int as n from knowledge_entries where product_id = ${productId} and ${slug} = any(tags)`;
  const [d] = await sql`select count(*)::int as n from reference_docs where product_id = ${productId} and ${slug} = any(tags)`;
  return { entries: e.n, docs: d.n };
}



export async function renameLabel(productId: string, oldSlug: string, newSlug: string) {
  if (oldSlug === newSlug) return { renamed: false, from: oldSlug, to: newSlug, entries: 0, docs: 0 };
  const [current] = await sql`select id from labels where product_id = ${productId} and slug = ${oldSlug}`;
  if (!current) throw notFound(`Label '${oldSlug}' not found for this product`);
  const [taken] = await sql`select id from labels where product_id = ${productId} and slug = ${newSlug}`;
  if (taken) throw conflict(`label '${newSlug}' already exists for this product`);
  return sql.begin(async (tx) => {
    const e = await tx`update knowledge_entries set tags = array_replace(tags, ${oldSlug}, ${newSlug})
      where product_id = ${productId} and ${oldSlug} = any(tags)`;
    const d = await tx`update reference_docs set tags = array_replace(tags, ${oldSlug}, ${newSlug})
      where product_id = ${productId} and ${oldSlug} = any(tags)`;
    await tx`update labels set slug = ${newSlug} where id = ${current.id}`;
    return { renamed: true, from: oldSlug, to: newSlug, entries: e.count, docs: d.count };
  });
}



export async function deleteLabel(productId: string, slug: string) {
  const [row] = await sql`
    delete from labels where product_id = ${productId} and slug = ${slug} returning slug
  `;
  if (!row) throw notFound(`Label '${slug}' not found for this product`);
  return { deleted: true, slug };
}
