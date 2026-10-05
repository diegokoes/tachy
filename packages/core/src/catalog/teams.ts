import type { TeamRow } from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, conflict, notFound } from "../infra/errors";
import { clearPermissionCache } from "../access/permissions";

export async function listTeams() {
  return sql<TeamRow[]>`select id, slug, name from teams order by name`;
}

export async function getTeamIdBySlug(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from teams where slug = ${slug}
  `;
  if (!row)
    throw badInput(
      `Unknown team '${slug}'. Call list_teams or add_team first.`,
    );
  return row.id;
}

export async function addTeam(slug: string, name: string) {
  const [row] = await sql`
    insert into teams (slug, name) values (${slug}, ${name})
    on conflict (slug) do update set name = excluded.name
    returning id, slug, name
  `;
  return row;
}

export async function updateTeam(
  currentSlug: string,
  patch: { name?: string; slug?: string },
) {
  const [current] =
    await sql`select id, slug, name from teams where slug = ${currentSlug}`;
  if (!current) throw notFound(`Team '${currentSlug}' not found`);
  try {
    const [row] = await sql`
      update teams set
        name = ${patch.name ?? current.name},
        slug = ${patch.slug ?? current.slug}
      where id = ${current.id}
      returning id, slug, name
    `;
    // Cached permission contexts hold team slugs, not ids.
    if (patch.slug && patch.slug !== current.slug) clearPermissionCache();
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      throw conflict(`slug '${patch.slug}' is already taken by another team`);
    throw e;
  }
}

export async function deleteTeam(slug: string) {
  const [team] = await sql`select id from teams where slug = ${slug}`;
  if (!team) throw notFound(`Team '${slug}' not found`);
  const [ref] =
    await sql`select count(*)::int as n from products where team_id = ${team.id}`;
  if (ref.n > 0)
    throw conflict(
      `team '${slug}' still owns ${ref.n} product(s) - delete or move them first`,
    );
  await sql`delete from teams where id = ${team.id}`;
  clearPermissionCache();
  return { deleted: true, slug };
}
