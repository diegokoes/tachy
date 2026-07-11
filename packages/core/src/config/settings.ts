import { z } from "zod";
import { sql } from "../infra/db";
import { badInput } from "../infra/errors";

export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const AGENT_PROVIDERS = ["claude", "copilot"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const DEPLOYMENT_PROFILES = ["support", "engineering"] as const;
export type DeploymentProfile = (typeof DEPLOYMENT_PROFILES)[number];

const SETTING_SCHEMAS = {
  redaction_global: z.boolean(),
  agent_provider: z.enum(AGENT_PROVIDERS),
  agent_model: z.string().min(1),
  agent_effort: z.enum(AGENT_EFFORTS),
  allowed_models: z.array(z.string().min(1)),
  org_name: z.string().min(1),
  deployment_profile: z.enum(DEPLOYMENT_PROFILES),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export type SettingsMap = {
  [K in SettingKey]?: z.infer<(typeof SETTING_SCHEMAS)[K]>;
};

let cache: SettingsMap | undefined;

export async function getSettings(): Promise<SettingsMap> {
  if (cache) return cache;
  const rows = await sql`select key, value from settings`;
  const out: SettingsMap = {};
  for (const row of rows) {
    const key = row.key as string;
    if (key in SETTING_SCHEMAS) {
      const parsed = SETTING_SCHEMAS[key as SettingKey].safeParse(row.value);
      if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
    }
  }
  cache = out;
  return out;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!(key in SETTING_SCHEMAS))
    throw badInput(
      `unknown setting '${key}' (known: ${SETTING_KEYS.join(", ")})`,
    );
  const parsed = SETTING_SCHEMAS[key as SettingKey].safeParse(value);
  if (!parsed.success)
    throw badInput(
      `invalid value for '${key}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  await sql`
    insert into settings (key, value) values (${key}, ${sql.json(parsed.data as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  cache = undefined;
}

export type SettingSource = "db" | "env" | "default";

export interface EffectiveSettings {
  redaction_global: { value: boolean; source: SettingSource };
  agent_provider: { value: AgentProvider; source: SettingSource };
  agent_model: { value: string; source: SettingSource };
  agent_effort: {
    value: (typeof AGENT_EFFORTS)[number];
    source: SettingSource;
  };
  allowed_models: { value: string[]; source: SettingSource };
  org_name: { value: string | null; source: SettingSource };
  deployment_profile: { value: DeploymentProfile; source: SettingSource };
}

export async function effectiveSettings(): Promise<EffectiveSettings> {
  const db = await getSettings();
  const pick = <T>(
    dbVal: T | undefined,
    envVal: T | undefined,
    dflt: T,
  ): { value: T; source: SettingSource } =>
    dbVal !== undefined
      ? { value: dbVal, source: "db" }
      : envVal !== undefined
        ? { value: envVal, source: "env" }
        : { value: dflt, source: "default" };

  const envEffort = AGENT_EFFORTS.includes(
    process.env.TACHY_AGENT_EFFORT as never,
  )
    ? (process.env.TACHY_AGENT_EFFORT as (typeof AGENT_EFFORTS)[number])
    : undefined;
  const envModels = process.env.TACHY_ALLOWED_MODELS
    ? process.env.TACHY_ALLOWED_MODELS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return {
    redaction_global: pick(
      db.redaction_global,
      process.env.TACHY_REDACT === "true" ? true : undefined,
      false,
    ),
    agent_provider: pick<AgentProvider>(
      db.agent_provider,
      AGENT_PROVIDERS.includes(process.env.TACHY_AGENT_PROVIDER as never)
        ? (process.env.TACHY_AGENT_PROVIDER as AgentProvider)
        : undefined,
      "claude",
    ),
    agent_model: pick(
      db.agent_model,
      process.env.TACHY_AGENT_MODEL || undefined,
      "claude-sonnet-5",
    ),
    agent_effort: pick(db.agent_effort, envEffort, "medium"),
    allowed_models: pick(db.allowed_models, envModels, []),
    org_name: pick<string | null>(db.org_name, undefined, null),
    deployment_profile: pick<DeploymentProfile>(
      db.deployment_profile,
      undefined,
      "support",
    ),
  };
}

export async function loadSettingsIntoEnv(): Promise<void> {
  const eff = await effectiveSettings();
  if (eff.redaction_global.value) process.env.TACHY_REDACT = "true";
}

export function clearSettingsCache(): void {
  cache = undefined;
}
