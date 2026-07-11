import { z } from "zod";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";
import {
  AGENT_EFFORTS,
  AGENT_PROVIDERS,
  effectiveSettings,
  type SettingSource,
} from "./settings";
import {
  resolveScoped,
  assertCanWriteScope,
  scopeCondition,
  upsertScoped,
  type Scope,
  type ScopeContext,
} from "./scoped";

/** Scoped (per-user/per-team) prefs; each falls back to the global setting. */
const PREF_SCHEMAS = {
  agent_provider: z.enum(AGENT_PROVIDERS),
  agent_model: z.string().min(1),
  agent_effort: z.enum(AGENT_EFFORTS),
} as const;

export type PrefKey = keyof typeof PREF_SCHEMAS;
export const PREF_KEYS = Object.keys(PREF_SCHEMAS) as PrefKey[];

export type PrefValue<K extends PrefKey> = z.infer<(typeof PREF_SCHEMAS)[K]>;

/** Where an effective preference value came from. */
export type PrefSource = "user" | "team" | SettingSource;

function parsePref<K extends PrefKey>(key: K, value: unknown): PrefValue<K> {
  const parsed = PREF_SCHEMAS[key].safeParse(value);
  if (!parsed.success)
    throw badInput(
      `invalid value for '${key}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  return parsed.data as PrefValue<K>;
}

function checkKey(key: string): asserts key is PrefKey {
  if (!(key in PREF_SCHEMAS))
    throw badInput(
      `unknown preference '${key}' (known: ${PREF_KEYS.join(", ")})`,
    );
}

export async function resolvePref<K extends PrefKey>(
  key: K,
  ctx: ScopeContext,
): Promise<{ value: PrefValue<K>; source: PrefSource }> {
  const hit = await resolveScoped("preferences", key, ctx);
  if (hit && hit.scope !== "global") {
    const parsed = PREF_SCHEMAS[key].safeParse(hit.row.value);
    if (parsed.success)
      return { value: parsed.data as PrefValue<K>, source: hit.scope };
  }
  const eff = await effectiveSettings();
  const setting = eff[key];
  return {
    value: setting.value as PrefValue<K>,
    source: setting.source,
  };
}

export async function effectivePrefs(
  ctx: ScopeContext,
): Promise<{ [K in PrefKey]: { value: PrefValue<K>; source: PrefSource } }> {
  const [agent_provider, agent_model, agent_effort] = await Promise.all([
    resolvePref("agent_provider", ctx),
    resolvePref("agent_model", ctx),
    resolvePref("agent_effort", ctx),
  ]);
  return { agent_provider, agent_model, agent_effort };
}

export async function setPref(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  key: string,
  value: unknown,
): Promise<void> {
  checkKey(key);
  const parsed = parsePref(key, value);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  await upsertScoped("preferences", scope, scopeId, key, {
    value: sql.json(parsed as never),
  });
}

export async function deletePref(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  key: string,
): Promise<boolean> {
  checkKey(key);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  const rows = await sql`
    delete from preferences
    where ${scopeCondition(scope, scopeId)} and key = ${key}
    returning id
  `;
  return rows.length > 0;
}
