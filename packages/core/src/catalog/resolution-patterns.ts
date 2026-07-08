import { sql } from "../platform/db";
import { conflict, notFound } from "../platform/errors";

/** The full controlled vocabulary, for Claude to pick from before tagging an entry. */
export async function listResolutionPatterns() {
  return sql`select slug, description from resolution_patterns order by slug`;
}

/** Deliberately add a new pattern. Separate from saving a knowledge entry on purpose. */
export async function addResolutionPattern(slug: string, description: string) {
  const [row] = await sql`
    insert into resolution_patterns (slug, description)
    values (${slug}, ${description})
    on conflict (slug) do update set description = excluded.description
    returning slug, description
  `;
  return row;
}

// knowledge_entries.resolution_pattern FKs this slug (no cascade), so a raw
// delete would hard-fail  pre-check and surface a human message instead.
export async function deleteResolutionPattern(slug: string) {
  const [exists] = await sql`select slug from resolution_patterns where slug = ${slug}`;
  if (!exists) throw notFound(`Resolution pattern '${slug}' not found`);
  const [ref] = await sql`select count(*)::int as n from knowledge_entries where resolution_pattern = ${slug}`;
  if (ref.n > 0)
    throw conflict(`pattern '${slug}' is used by ${ref.n} knowledge entr(y/ies) - re-tag them first`);
  await sql`delete from resolution_patterns where slug = ${slug}`;
  return { deleted: true, slug };
}
