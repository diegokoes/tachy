import { sql } from "./db";
import { env } from "./env";
import { badInput, notFound } from "./errors";
import { hashPassword } from "./passwords";

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];


export const TEAM_ROLES = ["admin", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  disabled: boolean;
  has_password: boolean;
  created_at: string;
}

export async function upsertUser(email: string, displayName?: string): Promise<string> {
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
  const [row] = await sql`select count(*)::int as n from users where role = 'admin' and not disabled`;
  return row.n as number;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await sql`
    select id, email, display_name, role, disabled,
           (password_hash is not null) as has_password, created_at
    from users order by created_at
  `;
  return rows as unknown as UserRow[];
}

export async function createUser(input: {
  email: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
}): Promise<UserRow> {
  const hash = input.password ? await hashPassword(input.password) : null;
  const rows = await sql`
    insert into users (email, display_name, role, password_hash)
    values (${input.email}, ${input.displayName ?? null}, ${input.role ?? "member"}, ${hash})
    on conflict (email) do nothing
    returning id, email, display_name, role, disabled, (password_hash is not null) as has_password, created_at
  `;
  if (rows.length === 0) throw badInput(`a user with email '${input.email}' already exists`);
  return rows[0] as unknown as UserRow;
}


export async function getUserByEmail(email: string): Promise<
  { id: string; email: string; display_name: string | null; role: UserRole; disabled: boolean; password_hash: string | null } | null
> {
  const [row] = await sql`
    select id, email, display_name, role, disabled, password_hash
    from users where email = ${email}
  `;
  return (row as never) ?? null;
}

async function requireUser(id: string): Promise<{ role: UserRole; disabled: boolean }> {
  const [row] = await sql`select role, disabled from users where id = ${id}`;
  if (!row) throw notFound(`user ${id} not found`);
  return row as never;
}

export async function setUserRole(id: string, role: UserRole): Promise<void> {
  const current = await requireUser(id);
  
  if (role !== "admin" && current.role === "admin" && !current.disabled && (await countAdmins()) <= 1)
    throw badInput("cannot demote the last admin");
  await sql`update users set role = ${role} where id = ${id}`;
}

export async function setUserPassword(id: string, password: string): Promise<void> {
  await requireUser(id);
  const hash = await hashPassword(password);
  await sql`update users set password_hash = ${hash} where id = ${id}`;
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<void> {
  const current = await requireUser(id);
  if (disabled && current.role === "admin" && !current.disabled && (await countAdmins()) <= 1)
    throw badInput("cannot disable the last admin");
  await sql`update users set disabled = ${disabled} where id = ${id}`;
}



export interface TeamMemberRow {
  user_id: string;
  email: string;
  display_name: string | null;
  team_role: TeamRole;
}

export async function listTeamMembers(teamSlug: string): Promise<TeamMemberRow[]> {
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


export async function setTeamMember(teamSlug: string, email: string, role: TeamRole | null): Promise<void> {
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
}
