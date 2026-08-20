import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import { sourceTokenOptional } from "../infra/env";
import { secretsEnabled, encryptSecret, decryptSecret } from "../infra/secrets";
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

/**
 * Claude Code OAuth token minted by `claude setup-token`. Authenticates as the
 * holder's Claude subscription seat rather than against Console API billing.
 */
export const ANTHROPIC_OAUTH_CREDENTIAL = "anthropic_oauth_token";

const OAUTH_PREFIX = "sk-ant-oat01-";

export const sourceCredentialName = (sourceType: string, slug: string) =>
  `${sourceType}_token:${slug}`;

const NAME_RE = /^[a-z0-9_-]+(:[a-z0-9][a-z0-9-]*)?$/;

function checkName(name: string): void {
  if (!NAME_RE.test(name))
    throw badInput(
      `invalid credential name '${name}' (expected e.g. 'anthropic_api_key' or 'freshdesk_token:my-connection')`,
    );
}

/**
 * Returns an error message if the value is the wrong shape for the given
 * credential name, null otherwise. Shape only: nothing observable in a token
 * says which Anthropic account or organisation minted it.
 */
export function validateCredential(name: string, value: string): string | null {
  if (name === AGENT_CREDENTIALS.claude && value.startsWith(OAUTH_PREFIX))
    return `${OAUTH_PREFIX} is a Claude Code OAuth token, not an API key — save it under 'Claude subscription token', or get a key (sk-ant-api03-…) from console.anthropic.com`;
  if (name === ANTHROPIC_OAUTH_CREDENTIAL && !value.startsWith(OAUTH_PREFIX))
    return `a Claude subscription token starts with ${OAUTH_PREFIX} — run 'claude setup-token' to mint one, or save an API key under 'Anthropic API key' instead`;
  return null;
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
