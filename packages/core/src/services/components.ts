import { sql } from "../db";

export async function listComponents(productId: string) {
  return sql`
    select id, parent_id, slug, name, description
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
}

export async function addComponent(i: AddComponentInput) {
  let parentId: string | null = null;
  if (i.parentSlug) {
    const [parent] = await sql`select id from components where product_id = ${i.productId} and slug = ${i.parentSlug}`;
    if (!parent) throw new Error(`Unknown parent component '${i.parentSlug}' for this product`);
    parentId = parent.id;
  }
  const [row] = await sql`
    insert into components (product_id, parent_id, slug, name, description)
    values (${i.productId}, ${parentId}, ${i.slug}, ${i.name}, ${i.description ?? null})
    on conflict (product_id, slug) do update set
      name = excluded.name,
      parent_id = excluded.parent_id,
      description = coalesce(excluded.description, components.description)
    returning id, slug, name, parent_id
  `;
  return row;
}
