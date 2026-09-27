import { sql } from "../infra/db";
import { badInput, forbidden } from "../infra/errors";
import { canManageTeam, assertGlobalAdmin } from "../access/permissions";

export const SCOPES = ["global", "team", "user"] as const;
export type Scope = (typeof SCOPES)[number];

export interface ScopeContext {
  userId?: string;
  teamId?: string;
}

/**
 * The tables resolved most-specific-wins, and the scopes each one has rows at.
 * `credentials` has no team scope: a secret belongs to one person, and its
 * global rows are the deployment's own machine tokens rather than a share.
 */
const SCOPED_TABLES = {
  credentials: { key: "name", scopes: ["user", "global"] },
  preferences: { key: "key", scopes: ["user", "team", "global"] },
  artifacts: { key: "slug", scopes: ["user", "team", "global"] },
} as const satisfies Record<string, { key: string; scopes: readonly Scope[] }>;
export type ScopedTable = keyof typeof SCOPED_TABLES;

export const scopesOf = (table: ScopedTable): readonly Scope[] =>
  SCOPED_TABLES[table].scopes;

/** The scopes one table has rows at, as a type. */
export type ScopeOf<T extends ScopedTable> =
  (typeof SCOPED_TABLES)[T]["scopes"][number];

export interface ScopedHit<S extends Scope = Scope> {
  row: Record<string, unknown>;
  scope: S;
}

/**
 * Most-specific-wins walk over a scoped table: user row, then team row, then
 * global row. Returns the winning row and which scope it came from. A table
 * that has no team scope never gets the team branch — its column is not there.
 */
export async function resolveScoped<T extends ScopedTable>(
  table: T,
  key: string,
  { userId, teamId }: ScopeContext,
): Promise<ScopedHit<ScopeOf<T>> | undefined> {
  const { key: keyColumn, scopes } = SCOPED_TABLES[table];
  const name: ScopedTable = table;
  const order = sql`order by case scope when 'user' then 0 when 'team' then 1 else 2 end limit 1`;
  const rows = (scopes as readonly Scope[]).includes("team")
    ? await sql`
        select * from ${sql(name)}
        where ${sql(keyColumn)} = ${key} and (
          (scope = 'user' and user_id = ${userId ?? null})
          or (scope = 'team' and team_id = ${teamId ?? null})
          or scope = 'global'
        )
        ${order}
      `
    : await sql`
        select * from ${sql(name)}
        where ${sql(keyColumn)} = ${key} and (
          (scope = 'user' and user_id = ${userId ?? null})
          or scope = 'global'
        )
        ${order}
      `;
  const row = rows[0];
  return row ? { row, scope: row.scope as ScopeOf<T> } : undefined;
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
        throw forbidden("this action requires team admin rights for that team");
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
  const { key: keyColumn, scopes } = SCOPED_TABLES[table];
  if (!(scopes as readonly Scope[]).includes(scope))
    throw badInput(`${table} has no ${scope} scope`);
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
