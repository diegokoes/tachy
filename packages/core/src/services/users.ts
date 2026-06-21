import { sql } from "../db";
import { env } from "../env";

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

// Resolves from TACHY_USER_EMAIL, upserting on first use and caching. Returns null if unconfigured.
export async function resolveCurrentUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  cachedUserId = env.userEmail ? await upsertUser(env.userEmail) : null;
  return cachedUserId;
}
