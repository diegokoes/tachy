import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { sourceTokenOptional } from "../infra/env";
import {
  secretsEnabled,
  encryptSecret,
  decryptSecret,
  vaultKeys,
} from "../infra/secrets";
import {
  resolveScoped,
  assertCanWriteScope,
  scopeCondition,
  upsertScoped,
  type Scope,
  type ScopeContext,
} from "./scoped";
import type { AgentProvider } from "./settings";
import {
  AGENT_CREDENTIALS,
  ANTHROPIC_OAUTH_CREDENTIAL,
  API_KEY_EXAMPLE,
  API_KEY_PREFIX,
  OAUTH_PREFIX,
  validateCredential,
} from "@tachy/contract";

/*
 * The prefixes travel with the names. packages/api imports only from
 * @tachy/core, so leaving them out of this line is what forced
 * routes/setup.ts to write "sk-ant-oat01-" out by hand — the second copy of a
 * rule the contract exists to hold once.
 */
export {
  AGENT_CREDENTIALS,
  ANTHROPIC_OAUTH_CREDENTIAL,
  API_KEY_EXAMPLE,
  API_KEY_PREFIX,
  OAUTH_PREFIX,
  validateCredential,
};

/** Where a resolved/available credential came from. */
export type CredentialSource = Scope | "env";

export const sourceCredentialName = (sourceType: string, slug: string) =>
  `${sourceType}_token:${slug}`;

const NAME_RE = /^[a-z0-9_-]+(:[a-z0-9][a-z0-9-]*)?$/;

function checkName(name: string): void {
  if (!NAME_RE.test(name))
    throw badInput(
      `invalid credential name '${name}' (expected e.g. 'anthropic_api_key' or 'freshdesk_token:my-connection')`,
    );
}

/** Env-var fallback for a credential name, for pre-vault deployments. */
export function envCredential(name: string): string | undefined {
  if (name === "anthropic_api_key") return process.env.ANTHROPIC_API_KEY;
  if (name === ANTHROPIC_OAUTH_CREDENTIAL)
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (name === "copilot_token")
    return (
      process.env.COPILOT_GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITHUB_TOKEN ||
      undefined
    );
  const m = name.match(/^([a-z0-9_-]+)_token:(.+)$/);
  if (m) return sourceTokenOptional(m[1], m[2]);
  return undefined;
}

/**
 * Most-specific-wins credential lookup: user > team > global > env var.
 * Returns plaintext — never expose the result through an API response.
 */
/**
 * Which row a ciphertext belongs to: its scope, whose it is, and what it is
 * called — exactly the columns the unique indexes are built on, so no two rows
 * share one. Moving a value to another row changes this, and the open fails.
 */
function credentialAad(row: Record<string, unknown>): string {
  return [row.scope, row.user_id ?? "", row.team_id ?? "", row.name].join(
    "\u0000",
  );
}

export async function resolveCredential(
  name: string,
  ctx: ScopeContext,
): Promise<string | undefined> {
  checkName(name);
  if (secretsEnabled()) {
    const hit = await resolveScoped("credentials", name, ctx);
    if (hit)
      return decryptSecret(
        hit.row as {
          value_ciphertext: Buffer;
          nonce: Buffer;
          key_id: string | null;
        },
        credentialAad(hit.row),
      );
  }
  return envCredential(name);
}

/** Availability without decryption — safe to report through the API. */
export async function credentialSource(
  name: string,
  ctx: ScopeContext,
): Promise<CredentialSource | undefined> {
  checkName(name);
  if (secretsEnabled()) {
    const hit = await resolveScoped("credentials", name, ctx);
    if (hit) return hit.scope;
  }
  return envCredential(name) !== undefined ? "env" : undefined;
}

/** How a turn authenticates to the model provider. */
export interface AgentAuth {
  kind: "anthropic_api_key" | "anthropic_oauth" | "copilot_token";
  value: string;
  source: CredentialSource;
}

const SOURCE_RANK: Record<CredentialSource, number> = {
  user: 0,
  team: 1,
  global: 2,
  env: 3,
};

/**
 * The credential a turn should authenticate with, and where it came from.
 * Claude accepts either an API key or a subscription token; the more specific
 * scope wins so a user's own token beats an org-wide key, and an API key wins
 * an exact tie.
 */
export async function resolveAgentAuth(
  provider: AgentProvider,
  ctx: ScopeContext,
): Promise<AgentAuth | undefined> {
  const read = async (
    name: string,
    kind: AgentAuth["kind"],
  ): Promise<AgentAuth | undefined> => {
    const [value, source] = await Promise.all([
      resolveCredential(name, ctx),
      credentialSource(name, ctx),
    ]);
    return value && source ? { kind, value, source } : undefined;
  };

  if (provider === "copilot")
    return read(AGENT_CREDENTIALS.copilot, "copilot_token");

  const candidates = (
    await Promise.all([
      read(AGENT_CREDENTIALS.claude, "anthropic_api_key"),
      read(ANTHROPIC_OAUTH_CREDENTIAL, "anthropic_oauth"),
    ])
  ).filter((c): c is AgentAuth => c !== undefined);

  // Stable sort, API key listed first, so an equal-scope tie keeps the key.
  candidates.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  return candidates[0];
}

export async function setCredential(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  name: string,
  value: string,
): Promise<void> {
  checkName(name);
  if (!value.trim()) throw badInput("credential value must not be empty");
  const invalid = validateCredential(name, value);
  if (invalid) throw badInput(invalid);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  const { ciphertext, nonce, keyId } = encryptSecret(
    value,
    credentialAad({
      scope,
      user_id: scope === "user" ? scopeId : null,
      team_id: scope === "team" ? scopeId : null,
      name,
    }),
  );
  await upsertScoped("credentials", scope, scopeId, name, {
    value_ciphertext: ciphertext,
    nonce,
    key_id: keyId,
    created_by: actorUserId,
  });
}

export async function deleteCredential(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  name: string,
): Promise<boolean> {
  checkName(name);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  const rows = await sql`
    delete from credentials
    where ${scopeCondition(scope, scopeId)} and name = ${name}
    returning id
  `;
  return rows.length > 0;
}

export interface CredentialMeta {
  name: string;
  scope: Scope;
  updated_at: string;
}

/** Metadata only — never the value. Route callers enforce read authz. */
export async function listCredentials(
  scope: Scope,
  scopeId?: string,
): Promise<CredentialMeta[]> {
  const rows = await sql`
    select name, scope, updated_at from credentials
    where ${scopeCondition(scope, scopeId)}
    order by name
  `;
  return rows.map((r) => ({
    name: r.name as string,
    scope: r.scope as Scope,
    updated_at: String(r.updated_at),
  }));
}

export interface VaultState {
  enabled: boolean;
  /** The key new secrets are written with. */
  current_key: string | null;
  /** How many stored credentials each key holds, oldest first. */
  by_key: { key_id: string | null; count: number; current: boolean }[];
}

/** What Admin > system shows about the vault, without decrypting anything. */
export async function vaultState(): Promise<VaultState> {
  const keys = vaultKeys();
  const rows = await sql<{ key_id: string | null; n: number }[]>`
    select key_id, count(*)::int as n from credentials group by key_id order by key_id nulls first
  `;
  return {
    enabled: keys.length > 0,
    current_key: keys[0]?.id ?? null,
    by_key: rows.map((r) => ({
      key_id: r.key_id,
      count: r.n,
      current: Boolean(keys[0] && r.key_id === keys[0].id),
    })),
  };
}

/**
 * Re-encrypts every stored credential with the current key. Run it after
 * putting the old key in TACHY_SECRET_KEY_PREVIOUS and the new one in
 * TACHY_SECRET_KEY; afterwards the old key can be dropped.
 */
export async function rotateVaultKey(): Promise<{
  moved: number;
  already: number;
}> {
  const keys = vaultKeys();
  if (!keys.length) throw badInput("TACHY_SECRET_KEY is not set");
  const current = keys[0];
  let moved = 0;
  let already = 0;
  const rows = await sql`select * from credentials order by created_at`;
  for (const row of rows) {
    if (row.key_id === current.id) {
      already++;
      continue;
    }
    const aad = credentialAad(row);
    const value = decryptSecret(
      row as { value_ciphertext: Buffer; nonce: Buffer; key_id: string | null },
      aad,
    );
    const { ciphertext, nonce, keyId } = encryptSecret(value, aad);
    await sql`
      update credentials
      set value_ciphertext = ${ciphertext}, nonce = ${nonce}, key_id = ${keyId}, updated_at = now()
      where id = ${row.id}
    `;
    moved++;
  }
  return { moved, already };
}
