import { z } from "zod";
import {
  CLOCKS,
  DATE_ORDERS,
  DEFAULT_DATE_FORMAT,
  type DateFormat,
} from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import { badInput } from "../infra/errors";
import {
  AGENT_EFFORTS,
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

/**
 * Scoped (per-user/per-team) prefs; each falls back to the global setting,
 * except the ones in `PERSONAL`.
 */
const PREF_SCHEMAS = {
  agent_model: z.string().min(1),
  agent_effort: z.enum(AGENT_EFFORTS),
  date_order: z.enum(DATE_ORDERS),
  clock: z.enum(CLOCKS),
} as const;

export type PrefKey = keyof typeof PREF_SCHEMAS;
export const PREF_KEYS = Object.keys(PREF_SCHEMAS) as PrefKey[];

export type PrefValue<K extends PrefKey> = z.infer<(typeof PREF_SCHEMAS)[K]>;

/**
 * How one person reads dates is theirs alone: no team or deployment default,
 * so an unset key is its built-in value.
 */
const PERSONAL = {
  date_order: DEFAULT_DATE_FORMAT.order,
  clock: DEFAULT_DATE_FORMAT.clock,
} as const;
type PersonalKey = keyof typeof PERSONAL;
type SettingKey = Exclude<PrefKey, PersonalKey>;

const isPersonal = (key: PrefKey): key is PersonalKey => key in PERSONAL;

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
  if (isPersonal(key)) {
    const parsed =
      hit?.scope === "user"
        ? PREF_SCHEMAS[key].safeParse(hit.row.value)
        : undefined;
    return parsed?.success
      ? { value: parsed.data as PrefValue<K>, source: "user" }
      : { value: PERSONAL[key] as PrefValue<K>, source: "default" };
  }
  if (hit && hit.scope !== "global") {
    const parsed = PREF_SCHEMAS[key].safeParse(hit.row.value);
    if (parsed.success)
      return { value: parsed.data as PrefValue<K>, source: hit.scope };
  }
  const eff = await effectiveSettings();
  const setting = eff[key as SettingKey];
  return {
    value: setting.value as PrefValue<K>,
    source: setting.source,
  };
}

export async function effectivePrefs(
  ctx: ScopeContext,
): Promise<{ [K in PrefKey]: { value: PrefValue<K>; source: PrefSource } }> {
  const [agent_model, agent_effort, date_order, clock] = await Promise.all([
    resolvePref("agent_model", ctx),
    resolvePref("agent_effort", ctx),
    resolvePref("date_order", ctx),
    resolvePref("clock", ctx),
  ]);
  return { agent_model, agent_effort, date_order, clock };
}

export async function dateFormatOf(ctx: ScopeContext): Promise<DateFormat> {
  const [order, clock] = await Promise.all([
    resolvePref("date_order", ctx),
    resolvePref("clock", ctx),
  ]);
  return { order: order.value, clock: clock.value };
}

export async function setPref(
  actorUserId: string,
  scope: Scope,
  scopeId: string | undefined,
  key: string,
  value: unknown,
): Promise<void> {
  checkKey(key);
  if (isPersonal(key) && scope !== "user")
    throw badInput(`'${key}' is personal; it can only be set per user`);
  const parsed = parsePref(key, value);
  await assertCanWriteScope(actorUserId, scope, scopeId);
  await upsertScoped("preferences", scope, scopeId, key, {
    value: jsonb(parsed),
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
