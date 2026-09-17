import type { TeamRole, UserRole } from "@tachy/contract";
import { sql } from "../infra/db";
import { env } from "../infra/env";
import { badInput, notFound } from "../infra/errors";
import { hashPassword } from "./passwords";
import { clearPermissionCache } from "./permissions";

export { USER_ROLES, TEAM_ROLES } from "@tachy/contract";
export type { UserRole, TeamRole } from "@tachy/contract";

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  disabled: boolean;
  has_password: boolean;
  service_account: boolean;
  password_login_allowed: boolean;
  created_at: string;
}

export async function upsertUser(
  email: string,
  displayName?: string,
): Promise<string> {
  const [row] = await sql`
    insert into users (email, display_name)
    values (${email}, ${displayName ?? null})
    on conflict (email) do update set
      display_name = coalesce(excluded.display_name, users.display_name)
    returning id
  `;
  return row.id as string;
}

let cachedUserId: string | null | undefined;

export async function resolveCurrentUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  cachedUserId = env.userEmail ? await upsertUser(env.userEmail) : null;
  return cachedUserId;
}

export async function countAdmins(): Promise<number> {
  const [row] =
    await sql`select count(*)::int as n from users where role = 'admin' and not disabled`;
  return row.n as number;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await sql`
    select id, email, display_name, role, disabled,
           (password_hash is not null) as has_password,
           service_account, password_login_allowed, created_at
    from users order by created_at
  `;
  return rows as unknown as UserRow[];
}

export async function createUser(input: {
  email: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
  serviceAccount?: boolean;
  passwordLoginAllowed?: boolean;
}): Promise<UserRow> {
  const hash = input.password ? await hashPassword(input.password) : null;
  const rows = await sql`
    insert into users (email, display_name, role, password_hash,
                       service_account, password_login_allowed)
    values (${input.email}, ${input.displayName ?? null}, ${input.role ?? "member"}, ${hash},
            ${input.serviceAccount ?? false}, ${input.passwordLoginAllowed ?? false})
    on conflict (email) do nothing
    returning id, email, display_name, role, disabled,
              (password_hash is not null) as has_password,
              service_account, password_login_allowed, created_at
  `;
  if (rows.length === 0)
    throw badInput(`a user with email '${input.email}' already exists`);
  return rows[0] as unknown as UserRow;
}

export async function getUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  disabled: boolean;
  password_hash: string | null;
  password_login_allowed: boolean;
} | null> {
  const [row] = await sql`
    select id, email, display_name, role, disabled, password_hash,
           password_login_allowed
    from users where email = ${email}
  `;
  return (row as never) ?? null;
}

async function requireUser(
  id: string,
): Promise<{ role: UserRole; disabled: boolean }> {
  const [row] = await sql`select role, disabled from users where id = ${id}`;
  if (!row) throw notFound(`user ${id} not found`);
  return row as never;
}

export async function setUserRole(id: string, role: UserRole): Promise<void> {
  const current = await requireUser(id);

  if (
    role !== "admin" &&
    current.role === "admin" &&
    !current.disabled &&
    (await countAdmins()) <= 1
  )
    throw badInput("cannot demote the last admin");
  await sql`update users set role = ${role} where id = ${id}`;
  clearPermissionCache();
}

export async function setUserDisplayName(
  id: string,
  displayName: string | null,
): Promise<void> {
  await requireUser(id);
  await sql`update users set display_name = ${displayName} where id = ${id}`;
}

export async function setUserPassword(
  id: string,
  password: string,
): Promise<void> {
  await requireUser(id);
  const hash = await hashPassword(password);
  await sql`update users set password_hash = ${hash} where id = ${id}`;
}

export async function setUserFlags(
  id: string,
  flags: { serviceAccount?: boolean; passwordLoginAllowed?: boolean },
): Promise<void> {
  await requireUser(id);
  if (flags.serviceAccount !== undefined)
    await sql`update users set service_account = ${flags.serviceAccount} where id = ${id}`;
  if (flags.passwordLoginAllowed !== undefined)
    await sql`update users set password_login_allowed = ${flags.passwordLoginAllowed} where id = ${id}`;
}

export async function setUserDisabled(
  id: string,
  disabled: boolean,
): Promise<void> {
  const current = await requireUser(id);
  if (
    disabled &&
    current.role === "admin" &&
    !current.disabled &&
    (await countAdmins()) <= 1
  )
    throw badInput("cannot disable the last admin");
  await sql`update users set disabled = ${disabled} where id = ${id}`;
  clearPermissionCache();
}

/**
 * The team rung used for scoped credential/preference resolution: the user's
 * team when membership is unambiguous, null when none or several.
 */
export async function userSoleTeamId(userId: string): Promise<string | null> {
  const rows =
    await sql`select team_id from team_members where user_id = ${userId} limit 2`;
  return rows.length === 1 ? (rows[0].team_id as string) : null;
}

export async function userTeams(
  userId: string,
): Promise<{ team_id: string; team_slug: string }[]> {
  const rows = await sql`
    select t.id as team_id, t.slug as team_slug
    from team_members tm
    join teams t on t.id = tm.team_id
    where tm.user_id = ${userId}
    order by t.slug
  `;
  return rows as unknown as { team_id: string; team_slug: string }[];
}

export interface TeamMemberRow {
  user_id: string;
  email: string;
  display_name: string | null;
  team_role: TeamRole;
}

export async function listTeamMembers(
  teamSlug: string,
): Promise<TeamMemberRow[]> {
  const rows = await sql`
    select u.id as user_id, u.email, u.display_name, tm.role as team_role
    from team_members tm
    join teams t on t.id = tm.team_id
    join users u on u.id = tm.user_id
    where t.slug = ${teamSlug}
    order by u.email
  `;
  return rows as unknown as TeamMemberRow[];
}

export interface MembershipRow {
  user_id: string;
  team_slug: string;
  team_name: string;
  team_role: TeamRole;
}

/** Every membership at once — the access table shows teams per user. */
export async function listMemberships(): Promise<MembershipRow[]> {
  const rows = await sql`
    select tm.user_id, t.slug as team_slug, t.name as team_name, tm.role as team_role
    from team_members tm
    join teams t on t.id = tm.team_id
    order by t.name
  `;
  return rows as unknown as MembershipRow[];
}

export async function setTeamMember(
  teamSlug: string,
  email: string,
  role: TeamRole | null,
): Promise<void> {
  const [team] = await sql`select id from teams where slug = ${teamSlug}`;
  if (!team) throw notFound(`team '${teamSlug}' not found`);
  const user = await getUserByEmail(email);
  if (!user) throw notFound(`user '${email}' not found`);
  if (role === null) {
    await sql`delete from team_members where team_id = ${team.id} and user_id = ${user.id}`;
  } else {
    await sql`
      insert into team_members (team_id, user_id, role) values (${team.id}, ${user.id}, ${role})
      on conflict (team_id, user_id) do update set role = excluded.role
    `;
  }
  clearPermissionCache();
}

/**
 * For the admin index: users, how many of them cannot sign in, and who can
 * curate. `teams_with_admin` counts teams from this domain's own membership
 * table rather than joining the catalog's — the caller compares it against the
 * team count it already has.
 *
 * `admins` and `team_admins` are both taken among the enabled, and an app admin
 * is never also counted as a team admin. That is what lets the overview draw
 * app admins / team admins / members / disabled as four parts of one roll
 * rather than four independent tallies.
 */
export async function userCensus() {
  const [row] = await sql`
    select
      count(*)::int as users,
      count(*) filter (where disabled)::int as disabled,
      count(*) filter (where role = 'admin' and not disabled)::int as admins,
      count(*) filter (
        where not disabled and role <> 'admin'
          and exists (select 1 from team_members m
                        where m.user_id = users.id and m.role = 'admin')
      )::int as team_admins,
      count(*) filter (where password_hash is not null)::int as with_password,
      (select count(distinct team_id)::int from team_members where role = 'admin')
        as teams_with_admin,
      (select count(*)::int from users u
        where not exists (select 1 from team_members m where m.user_id = u.id))
        as users_no_team
    from users
  `;
  /* Named, not just counted: the overview opens this list when the ring is
     clicked, and "3 teams have no admin" is only actionable once you know
     which three. */
  const teams_without_admin = await sql<{ slug: string; name: string }[]>`
    select t.slug, t.name from teams t
    where not exists (
      select 1 from team_members m where m.team_id = t.id and m.role = 'admin'
    )
    order by t.name
  `;
  return { ...row, teams_without_admin: [...teams_without_admin] } as {
    users: number;
    disabled: number;
    admins: number;
    team_admins: number;
    with_password: number;
    teams_with_admin: number;
    teams_without_admin: { slug: string; name: string }[];
    users_no_team: number;
  };
}
