import { sql } from "../infra/db";
import type { Db } from "../infra/db";

/**
 * A slug handed to a live article stops being anyone's alias. Called on create
 * and rename, so the article that holds a slug now always beats the one that
 * used to.
 */
export async function releaseSlug(
  db: Db,
  productId: string | null,
  slug: string,
): Promise<void> {
  await db`
    delete from wiki_slug_aliases
    where product_id is not distinct from ${productId} and slug = ${slug}
  `;
}

/** Keep answering to `from` after an article is renamed to `to`. */
export async function rememberOldSlug(
  db: Db,
  productId: string | null,
  from: string,
  to: string,
  docId: string,
): Promise<void> {
  await db`
    delete from wiki_slug_aliases
    where product_id is not distinct from ${productId}
      and slug in (${from}, ${to})
  `;
  await db`
    insert into wiki_slug_aliases (product_id, slug, doc_id)
    values (${productId}, ${from}, ${docId})
  `;
}

/** Docs whose body links to `docId` by the slug it had before a rename. */
export async function linkersBySlug(
  docId: string,
  slug: string,
): Promise<{ id: string; body: string; version: number }[]> {
  return sql`
    select distinct d.id, d.body, d.version
    from library_links l
    join reference_docs d on d.id = l.from_doc_id
    where l.kind = 'mentions' and l.to_doc_id = ${docId}
      and l.target = ${slug} and d.id <> ${docId}
  ` as Promise<{ id: string; body: string; version: number }[]>;
}
