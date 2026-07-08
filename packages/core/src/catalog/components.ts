import { sql } from "../platform/db";
import { badInput, conflict, notFound } from "../platform/errors";

export async function listComponents(productId: string) {
  return sql`
    select id, parent_id, slug, name, description, aliases
    from components where product_id = ${productId}
    order by slug
  `;
}

export interface AddComponentInput {
  productId: string;
  slug: string;
  name: string;
  parentSlug?: string;
  description?: string;
  aliases?: string[];
}

export async function addComponent(i: AddComponentInput) {
  let parentId: string | null = null;
  if (i.parentSlug) {
    const [parent] = await sql`select id from components where product_id = ${i.productId} and slug = ${i.parentSlug}`;
    if (!parent) throw badInput(`Unknown parent component '${i.parentSlug}' for this product`);
    parentId = parent.id;
  }
  const [row] = await sql`
    insert into components (product_id, parent_id, slug, name, description, aliases)
    values (${i.productId}, ${parentId}, ${i.slug}, ${i.name}, ${i.description ?? null}, ${i.aliases ?? []})
    on conflict (product_id, slug) do update set
      name = excluded.name,
      parent_id = excluded.parent_id,
      description = coalesce(excluded.description, components.description),
      aliases = excluded.aliases
    returning id, slug, name, parent_id, aliases
  `;
  return row;
}

// Partial edit; the slug is the stable taxonomy reference and stays immutable.
// parentSlug: null detaches from the parent, a slug re-parents (cycles rejected
// by re-parenting onto a descendant being impossible to express here  the
// parent must already exist and differ from the component itself).
export async function updateComponent(
  productId: string,
  slug: string,
  patch: { name?: string; parentSlug?: string | null; description?: string | null; aliases?: string[] },
) {
  const [current] = await sql`
    select id, name, parent_id, description, aliases from components
    where product_id = ${productId} and slug = ${slug}
  `;
  if (!current) throw notFound(`Component '${slug}' not found for this product`);

  let parentId: string | null = current.parent_id;
  if ('parentSlug' in patch) {
    if (patch.parentSlug == null) {
      parentId = null;
    } else {
      if (patch.parentSlug === slug) throw badInput("a component cannot be its own parent");
      const [parent] = await sql`select id from components where product_id = ${productId} and slug = ${patch.parentSlug}`;
      if (!parent) throw badInput(`Unknown parent component '${patch.parentSlug}' for this product`);
      parentId = parent.id;
    }
  }

  const [row] = await sql`
    update components set
      name        = ${patch.name ?? current.name},
      parent_id   = ${parentId},
      description = ${'description' in patch ? patch.description : current.description},
      aliases     = ${patch.aliases ?? current.aliases}
    where id = ${current.id}
    returning id, slug, name, parent_id, description, aliases
  `;
  return row;
}

// Child components would cascade away and linked entries would silently lose
// their component (FK is on delete set null), so refuse while referenced.
export async function deleteComponent(productId: string, slug: string) {
  const [current] = await sql`select id from components where product_id = ${productId} and slug = ${slug}`;
  if (!current) throw notFound(`Component '${slug}' not found for this product`);
  const [children] = await sql`select count(*)::int as n from components where parent_id = ${current.id}`;
  if (children.n > 0)
    throw conflict(`component '${slug}' has ${children.n} child component(s) - re-parent or delete them first`);
  const [entries] = await sql`select count(*)::int as n from knowledge_entries where component_id = ${current.id}`;
  if (entries.n > 0)
    throw conflict(`component '${slug}' is linked from ${entries.n} knowledge entr(y/ies) - re-map them first`);
  await sql`delete from components where id = ${current.id}`;
  return { deleted: true, slug };
}

export interface ResolvedComponent {
  id: string;
  slug: string;
  path: string; // "Product / Ancestor / … / Component", derived from the hierarchy
}

// Strict resolution for the SAVE path: unlike resolveComponentTags there is no
// silent fallback — an unknown value is rejected with nearest-match suggestions,
// so a typo can't silently become a new taxonomy value.
export async function resolveComponentStrict(productId: string, slugOrAlias: string): Promise<ResolvedComponent> {
  const [row] = await sql`
    select id, slug from components
    where product_id = ${productId}
      and (slug = ${slugOrAlias} or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slugOrAlias})))
    limit 1
  `;
  if (row) {
    return { id: row.id as string, slug: row.slug as string, path: await getComponentPath(row.id as string) };
  }

  const nearest = await sql`
    select slug from components
    where product_id = ${productId}
    order by greatest(
      similarity(slug, ${slugOrAlias}),
      similarity(name, ${slugOrAlias}),
      coalesce((select max(similarity(a, ${slugOrAlias})) from unnest(aliases) a), 0)
    ) desc
    limit 5
  `;
  const hint = nearest.length
    ? ` Nearest matches: ${nearest.map((r) => `'${r.slug}'`).join(", ")}.`
    : "";
  throw badInput(
    `Unknown component '${slugOrAlias}' for this product.${hint} Pick an existing slug/alias from list_components, or propose add_component in the review step and call it after user approval.`,
  );
}

// Recompute the display path for an already-linked component (update path).
export async function getComponentPath(componentId: string): Promise<string> {
  const [row] = await sql`
    with recursive chain as (
      select id, parent_id, product_id, name, 1 as depth from components where id = ${componentId}
      union all
      select c.id, c.parent_id, c.product_id, c.name, chain.depth + 1
      from components c join chain on c.id = chain.parent_id
    )
    select
      (select p.name from products p where p.id = (select product_id from chain where depth = 1)) || ' / ' ||
        string_agg(name, ' / ' order by depth desc) as path
    from chain
  `;
  if (!row?.path) throw badInput(`Unknown component id '${componentId}'`);
  return row.path as string;
}

// Expand a component slug/alias into the set of tag values that should match it,
// so "filter by line controller" catches entries tagged 'lc', 'LC', etc. Falls
// back to the raw input when no component is registered, so it still works as a
// plain tag filter.
export async function resolveComponentTags(productId: string, slugOrAlias: string): Promise<string[]> {
  const [row] = await sql`
    select slug, aliases from components
    where product_id = ${productId}
      and (slug = ${slugOrAlias} or exists (select 1 from unnest(aliases) a where lower(a) = lower(${slugOrAlias})))
    limit 1
  `;
  if (!row) return [slugOrAlias];
  return [row.slug as string, ...((row.aliases as string[]) ?? [])];
}

// The FILTER path (search/list): a registered component filters by FK link OR
// its slug/aliases as tags (legacy entries); an unregistered value degrades to
// a plain tag filter. Shared by the MCP search tool and the HTTP routes.
export async function resolveComponentFilter(
  productId: string,
  slugOrAlias: string,
): Promise<{ componentId?: string; componentTags?: string[]; extraTags?: string[] }> {
  const tags = await resolveComponentTags(productId, slugOrAlias);
  try {
    const componentId = (await resolveComponentStrict(productId, slugOrAlias)).id;
    return { componentId, componentTags: tags };
  } catch {
    return { extraTags: tags };
  }
}
