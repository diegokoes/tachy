import { sql } from "../infra/db";
import { conflict, notFound } from "../infra/errors";

/**
 * Product-scoped vocabularies whose slugs are also written into the `tags`
 * arrays of knowledge entries and reference docs, so a rename rewrites those
 * arrays along with the row.
 */
type ProductTagTable = "labels" | "components";

const NOUN: Record<ProductTagTable, string> = {
  labels: "label",
  components: "component",
};

async function tagId(
  table: ProductTagTable,
  productId: string,
  slug: string,
): Promise<string | undefined> {
  const [row] = await sql<{ id: string }[]>`
    select id from ${sql(table)} where product_id = ${productId} and slug = ${slug}
  `;
  return row?.id;
}

function missing(table: ProductTagTable, slug: string) {
  const noun = NOUN[table];
  return notFound(
    `${noun[0].toUpperCase()}${noun.slice(1)} '${slug}' not found for this product`,
  );
}

export async function productTagRenameImpact(
  table: ProductTagTable,
  productId: string,
  slug: string,
): Promise<{ entries: number; docs: number }> {
  if (!(await tagId(table, productId, slug))) throw missing(table, slug);
  const [e] = await sql<{ n: number }[]>`
    select count(*)::int as n from knowledge_entries
    where product_id = ${productId} and ${slug} = any(tags)
  `;
  const [d] = await sql<{ n: number }[]>`
    select count(*)::int as n from reference_docs
    where product_id = ${productId} and ${slug} = any(tags)
  `;
  return { entries: e.n, docs: d.n };
}

export async function renameProductTag(
  table: ProductTagTable,
  productId: string,
  oldSlug: string,
  newSlug: string,
) {
  if (oldSlug === newSlug)
    return { renamed: false, from: oldSlug, to: newSlug, entries: 0, docs: 0 };
  const id = await tagId(table, productId, oldSlug);
  if (!id) throw missing(table, oldSlug);
  if (await tagId(table, productId, newSlug))
    throw conflict(
      `${NOUN[table]} '${newSlug}' already exists for this product`,
    );
  return sql.begin(async (tx) => {
    const e = await tx`
      update knowledge_entries set tags = array_replace(tags, ${oldSlug}, ${newSlug})
      where product_id = ${productId} and ${oldSlug} = any(tags)
    `;
    const d = await tx`
      update reference_docs set tags = array_replace(tags, ${oldSlug}, ${newSlug})
      where product_id = ${productId} and ${oldSlug} = any(tags)
    `;
    await tx`update ${sql(table)} set slug = ${newSlug} where id = ${id}`;
    return {
      renamed: true,
      from: oldSlug,
      to: newSlug,
      entries: e.count,
      docs: d.count,
    };
  });
}
