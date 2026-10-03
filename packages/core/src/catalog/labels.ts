import type { LabelRow } from "@tachy/contract";
import { sql } from "../infra/db";
import { notFound } from "../infra/errors";
import { productTagRenameImpact, renameProductTag } from "./product-tags";

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
