import {
  POOL_LABEL_RE,
  mcpServerCredentialName,
  type McpPoolCredential,
  type McpServerRow,
} from "@tachy/contract";
import {
  deleteCredential,
  getUserCredential,
  listGlobalCredentialValues,
  setCredential,
} from "../config/credentials";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { credentialStates } from "./budget";

/** `key` names the credential in the budget; never the secret. */
export interface ServerCredential {
  key: string;
  token: string;
}

export const userCredentialKey = (userId: string) => `user:${userId}`;
export const poolCredentialKey = (label: string) => `shared:${label}`;

/** The person's own row only. */
export async function ownToken(
  slug: string,
  userId: string,
): Promise<ServerCredential | null> {
  const token = await getUserCredential(mcpServerCredentialName(slug), userId);
  return token ? { key: userCredentialKey(userId), token } : null;
}

const poolPrefix = (slug: string) => `${mcpServerCredentialName(slug)}:`;

export async function poolTokens(slug: string): Promise<ServerCredential[]> {
  const prefix = poolPrefix(slug);
  const rows = await listGlobalCredentialValues(prefix);
  return rows.map((row) => ({
    key: poolCredentialKey(row.name.slice(prefix.length)),
    token: row.value,
  }));
}

function assertLabel(label: string): void {
  if (!POOL_LABEL_RE.test(label))
    throw badInput(
      `invalid label '${label}': lowercase letters, digits and hyphens only`,
    );
}

export async function setPoolToken(
  actorUserId: string,
  slug: string,
  label: string,
  value: string,
): Promise<void> {
  assertLabel(label);
  await setCredential(
    actorUserId,
    "global",
    undefined,
    mcpServerCredentialName(slug, label),
    value,
  );
}

export async function deletePoolToken(
  actorUserId: string,
  slug: string,
  label: string,
): Promise<boolean> {
  assertLabel(label);
  return deleteCredential(
    actorUserId,
    "global",
    undefined,
    mcpServerCredentialName(slug, label),
  );
}

/** Labels, budget and rest; no values. */
export async function listPoolCredentials(
  server: McpServerRow,
): Promise<McpPoolCredential[]> {
  const prefix = poolPrefix(server.slug);
  const rows = await sql`
    select name, updated_at from credentials
    where scope = 'global' and starts_with(name, ${prefix})
    order by name
  `;
  const labels = rows.map((row) => (row.name as string).slice(prefix.length));
  const states = await credentialStates(
    server.id,
    labels.map(poolCredentialKey),
    server.rate_windows,
  );
  return rows.map((row, index) => ({
    label: labels[index]!,
    updated_at: String(row.updated_at),
    usage: states[index]!.usage,
    cooling_until: states[index]!.coolingUntil?.toISOString() ?? null,
  }));
}
