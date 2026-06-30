import { sql } from "../platform/db";

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
