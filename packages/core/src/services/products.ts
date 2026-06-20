import { sql } from "../db";

/** Resolve a product slug (e.g. 'tpd') to its id, for tools that take a human-friendly slug. */
export async function getProductIdBySlug(slug: string): Promise<string> {
  const [row] = await sql`select id from products where slug = ${slug}`;
  if (!row) throw new Error(`Unknown product '${slug}'. Check db/schema.sql's seed or add a products row.`);
  return row.id as string;
}
