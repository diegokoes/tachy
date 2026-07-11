import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { sourceTokenOptional } from "../infra/env";
import {
  secretsEnabled,
  encryptSecret,
  decryptSecret,
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

/** Where a resolved/available credential came from. */
export type CredentialSource = Scope | "env";

export const AGENT_CREDENTIALS: Record<AgentProvider, string> = {
  claude: "anthropic_api_key",
  copilot: "copilot_token",
};

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
export async function resolveCredential(
  name: string,
  ctx: ScopeContext,
): Promise<string | undefined> {
  checkName(name);
  if (secretsEnabled()) {
    const hit = await resolveScoped("credentials", name, ctx);
    if (hit)
      return decryptSecret(
        hit.row as { value_ciphertext: Buffer; nonce: Buffer },
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

export async function setCredential(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  name: string,
  value: string,
): Promise<void> {
  checkName(name);
  if (!value.trim()) throw badInput("credential value must not be empty");
  await assertCanWriteScope(actorUserId, scope, scopeId);
  const { ciphertext, nonce } = encryptSecret(value);
  await upsertScoped("credentials", scope, scopeId, name, {
    value_ciphertext: ciphertext,
    nonce,
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
