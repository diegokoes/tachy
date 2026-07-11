import { sql } from "../infra/db";
import { badInput, forbidden } from "../infra/errors";
import { canManageTeam, assertGlobalAdmin } from "../access/permissions";

export const SCOPES = ["global", "team", "user"] as const;
export type Scope = (typeof SCOPES)[number];

export interface ScopeContext {
  userId?: string;
  teamId?: string;
}

/** The tables that share the user → team → global layout. */
const SCOPED_TABLES = {
  credentials: "name",
  preferences: "key",
  artifacts: "slug",
} as const;
export type ScopedTable = keyof typeof SCOPED_TABLES;

export interface ScopedHit {
  row: Record<string, unknown>;
  scope: Scope;
}

/**
 * Most-specific-wins walk over a scoped table: user row, then team row, then
 * global row. Returns the winning row and which scope it came from.
 */
export async function resolveScoped(
  table: ScopedTable,
  key: string,
  { userId, teamId }: ScopeContext,
): Promise<ScopedHit | undefined> {
  const keyColumn = SCOPED_TABLES[table];
  const rows = await sql`
    select * from ${sql(table)}
    where ${sql(keyColumn)} = ${key} and (
      (scope = 'user' and user_id = ${userId ?? null})
      or (scope = 'team' and team_id = ${teamId ?? null})
      or scope = 'global'
    )
    order by case scope when 'user' then 0 when 'team' then 1 else 2 end
    limit 1
  `;
  const row = rows[0];
  return row ? { row, scope: row.scope as Scope } : undefined;
}

/**
 * Write guard shared by credentials and preferences: users write only their
 * own rows, team rows need team-admin, global rows need global admin.
 */
export async function assertCanWriteScope(
  userId: string,
  scope: Scope,
  scopeId?: string,
): Promise<void> {
  switch (scope) {
    case "user":
      if (scopeId !== userId)
        throw forbidden("you can only manage your own settings");
      return;
    case "team":
      if (!scopeId) throw badInput("team scope requires a team id");
      if (!(await canManageTeam(userId, scopeId)))
        throw forbidden("this action requires admin rights for that team");
      return;
    case "global":
      await assertGlobalAdmin(userId);
      return;
  }
}

/** WHERE fragment matching one exact scope row (for writes/deletes). */
export function scopeCondition(scope: Scope, scopeId?: string) {
  return scope === "user"
    ? sql`scope = 'user' and user_id = ${scopeId!}`
    : scope === "team"
      ? sql`scope = 'team' and team_id = ${scopeId!}`
      : sql`scope = 'global'`;
}

/** Upsert one scoped row, targeting the partial unique index for its scope. */
export async function upsertScoped(
  table: ScopedTable,
  scope: Scope,
  scopeId: string | undefined,
  key: string,
  values: Record<string, unknown>,
): Promise<void> {
  const keyColumn = SCOPED_TABLES[table];
  const row = {
    scope,
    ...(scope === "team" ? { team_id: scopeId! } : {}),
    ...(scope === "user" ? { user_id: scopeId! } : {}),
    [keyColumn]: key,
    ...values,
  };
  if (scope === "global")
    await sql`
      insert into ${sql(table)} ${sql(row)}
      on conflict (${sql(keyColumn)}) where scope = 'global'
      do update set ${sql(values)}, updated_at = now()
    `;
  else if (scope === "team")
    await sql`
      insert into ${sql(table)} ${sql(row)}
      on conflict (${sql("team_id")}, ${sql(keyColumn)}) where scope = 'team'
      do update set ${sql(values)}, updated_at = now()
    `;
  else
    await sql`
      insert into ${sql(table)} ${sql(row)}
      on conflict (${sql("user_id")}, ${sql(keyColumn)}) where scope = 'user'
      do update set ${sql(values)}, updated_at = now()
    `;
}
