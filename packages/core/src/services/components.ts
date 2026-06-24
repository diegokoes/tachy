import { sql } from "../db";

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
    if (!parent) throw new Error(`Unknown parent component '${i.parentSlug}' for this product`);
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
