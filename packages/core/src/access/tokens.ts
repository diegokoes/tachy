import { createHash, randomBytes } from "node:crypto";
import {
  API_TOKEN_PREFIX,
  type ApiTokenRow,
  type UserRole,
} from "@tachy/contract";
import { sql } from "../infra/db";
import { badInput, notFound } from "../infra/errors";

/**
 * The token is 256 random bits, so a plain sha256 makes the stored column
 * useless to whoever reads it; a slow hash buys nothing here.
 */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest();

const TOKEN_COLUMNS = sql`
  id, name, hint, created_at, last_used_at, expires_at, revoked_at
`;

export interface ApiTokenInput {
  userId: string;
  name: string;
  /** Null or absent: no expiry. */
  expiresAt?: Date | null;
  createdBy?: string | null;
}

/** A new token for the user. The return is the only time the token exists in the clear. */
export async function mintApiToken(
  input: ApiTokenInput,
): Promise<{ token: string; row: ApiTokenRow }> {
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now())
    throw badInput("a token cannot expire in the past");
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const [row] = await sql<ApiTokenRow[]>`
    insert into api_tokens (user_id, name, token_hash, hint, created_by, expires_at)
    values (${input.userId}, ${input.name}, ${hashToken(token)}, ${token.slice(-4)},
            ${input.createdBy ?? null}, ${input.expiresAt ?? null})
    returning ${TOKEN_COLUMNS}
  `;
  return { token, row };
}

/** Newest first, revoked and expired ones included: the list is also the record. */
export async function listApiTokens(userId: string): Promise<ApiTokenRow[]> {
  return sql<ApiTokenRow[]>`
    select ${TOKEN_COLUMNS} from api_tokens
    where user_id = ${userId}
    order by created_at desc
  `;
}

/** Stops the token working at once. Revoking twice keeps the first time. */
export async function revokeApiToken(
  id: string,
  userId: string,
): Promise<ApiTokenRow> {
  const [row] = await sql<ApiTokenRow[]>`
    update api_tokens set revoked_at = coalesce(revoked_at, now())
    where id = ${id} and user_id = ${userId}
    returning ${TOKEN_COLUMNS}
  `;
  if (!row) throw notFound("no such token on this account");
  return row;
}

/**
 * The account a bearer token acts as, or null: unknown, revoked, expired, or
 * its owner disabled. A hit is stamped, so an unused token shows in the list.
 */
export async function userByApiToken(token: string): Promise<{
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
} | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const [row] = await sql`
    update api_tokens t set last_used_at = now()
    from users u
    where t.token_hash = ${hashToken(token)}
      and u.id = t.user_id and not u.disabled
      and t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
    returning u.id, u.email, u.display_name, u.role
  `;
  return (row as never) ?? null;
}
