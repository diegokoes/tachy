import { sql } from "../infra/db";

/**
 * The hint an unknown-slug error ends with: up to five slugs in `table` closest
 * to `text` by trigram similarity to the slug, the name or any alias, within
 * `scope` when given. Empty when there is nothing to suggest.
 */
export async function nearestSlugsHint(
  table: "components" | "customers" | "customer_units",
  text: string,
  scope?: { column: "product_id" | "customer_id"; id: string },
): Promise<string> {
  const rows = await sql<{ slug: string }[]>`
    select slug from ${sql(table)}
    ${scope ? sql`where ${sql(scope.column)} = ${scope.id}` : sql``}
    order by greatest(
      similarity(slug, ${text}),
      similarity(name, ${text}),
      coalesce((select max(similarity(a, ${text})) from unnest(aliases) a), 0)
    ) desc
    limit 5
  `;
  return rows.length
    ? ` Nearest matches: ${rows.map((r) => `'${r.slug}'`).join(", ")}.`
    : "";
}
