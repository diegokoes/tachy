import { sql } from "../db";
import { env } from "../env";

/** Upsert a user by email, returning its id. Display name is updated when given. */
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

/**
 * Resolve the current user's id from TACHY_USER_EMAIL, upserting on first use
 * and caching the result. Returns null when no user email is configured, so
 * entries are simply left unattributed rather than failing.
 */
export async function resolveCurrentUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  cachedUserId = env.userEmail ? await upsertUser(env.userEmail) : null;
  return cachedUserId;
}
