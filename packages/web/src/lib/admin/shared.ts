export type Team = { id: string; slug: string; name: string };
export type Product = {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  team_slug: string;
  team_name: string;
};
export type Component = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  aliases: string[] | null;
};
export type Label = { id: string; slug: string; description: string | null };
export type Customer = {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  notes: string | null;
};
export type Pattern = { slug: string; description: string };
export type Connection = {
  id: string;
  source_type: string;
  slug: string;
  base_url: string | null;
  config: Record<string, unknown> | null;
};
export type ProductMap = {
  id: string;
  source_slug: string;
  external_group_key: string;
  product_slug: string;
  product_name: string;
};
export type Setting<T> = { value: T; source: "db" | "env" | "default" };
export type SystemInfo = {
  settings: {
    redaction_global: Setting<boolean>;
    agent_provider: Setting<"claude" | "copilot">;
    agent_model: Setting<string>;
    agent_effort: Setting<string>;
    allowed_models: Setting<string[]>;
    org_name: Setting<string | null>;
    deployment_profile: Setting<"support" | "engineering">;
  };
  credentials: {
    vault_enabled: boolean;
    anthropic_api_key: "global" | "env" | null;
    copilot_token: "global" | "env" | null;
  };
  env: {
    auth_mode: string;
    port: number;
    user_email: string | null;
    oidc_configured: boolean;
    api_token_set: boolean;
    session_secret_set: boolean;
    anthropic_api_key_set: boolean;
    copilot_token_set: boolean;
    upload_dir: string | null;
  };
};
export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "member";
  disabled: boolean;
  has_password: boolean;
  created_at: string;
};
export type Member = {
  user_id: string;
  email: string;
  display_name: string | null;
  team_role: string;
};

export const TIP = {
  slug: "Stable lowercase machine id (no spaces) used in filters, URLs and by the agent. Immutable once things reference it.",
  aliases:
    'Alternative names that resolve to the same record (lc, LC, "line controller"). Keeps naming variants from becoming duplicates.',
  parent:
    "Parent component in the hierarchy - product_area paths (Product / Parent / Component) are derived from it.",
  team: "Owning team. One team can own many products.",
  group:
    "The source system's own grouping key: a Freshdesk group id, a GitHub owner/repo…",
};

export const AGENT_KEY_LABELS: Record<string, string> = {
  anthropic_api_key: "Anthropic API key",
  copilot_token: "Copilot GitHub token",
};

export const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

export const aliasText = (a: string[] | null) =>
  a?.length ? a.join(", ") : "";

export const errText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
