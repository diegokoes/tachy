import { sql } from "../infra/db";
import { conflict, notFound } from "../infra/errors";

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

export async function resolutionPatternRenameImpact(
  slug: string,
): Promise<{ entries: number }> {
  const [exists] =
    await sql`select slug from resolution_patterns where slug = ${slug}`;
  if (!exists) throw notFound(`Resolution pattern '${slug}' not found`);
  const [ref] =
    await sql`select count(*)::int as n from knowledge_entries where resolution_pattern = ${slug}`;
  return { entries: ref.n };
}

export async function renameResolutionPattern(
  oldSlug: string,
  newSlug: string,
) {
  if (oldSlug === newSlug)
    return { renamed: false, from: oldSlug, to: newSlug, entries: 0 };
  const [exists] =
    await sql`select slug from resolution_patterns where slug = ${oldSlug}`;
  if (!exists) throw notFound(`Resolution pattern '${oldSlug}' not found`);
  const [taken] =
    await sql`select slug from resolution_patterns where slug = ${newSlug}`;
  if (taken) throw conflict(`resolution pattern '${newSlug}' already exists`);
  const [ref] =
    await sql`select count(*)::int as n from knowledge_entries where resolution_pattern = ${oldSlug}`;
  await sql`update resolution_patterns set slug = ${newSlug} where slug = ${oldSlug}`;
  return { renamed: true, from: oldSlug, to: newSlug, entries: ref.n };
}

export async function deleteResolutionPattern(slug: string) {
  const [exists] =
    await sql`select slug from resolution_patterns where slug = ${slug}`;
  if (!exists) throw notFound(`Resolution pattern '${slug}' not found`);
  const [ref] =
    await sql`select count(*)::int as n from knowledge_entries where resolution_pattern = ${slug}`;
  if (ref.n > 0)
    throw conflict(
      `pattern '${slug}' is used by ${ref.n} knowledge entr(y/ies) - re-tag them first`,
    );
  await sql`delete from resolution_patterns where slug = ${slug}`;
  return { deleted: true, slug };
}
