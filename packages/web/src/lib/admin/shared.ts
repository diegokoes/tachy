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
  /** Scope the caller's API token resolves from; null when none is set. */
  token_source?: "user" | "team" | "global" | "env" | null;
};
export type ProjectRole = "knowledge" | "tracker";
export type ProjectWiki = {
  identifier: string;
  name?: string;
  root_path?: string;
};
export type SourceProject = {
  id: string;
  source_connection_id: string;
  source_slug: string;
  source_type: string;
  external_key: string;
  name: string;
  role: ProjectRole;
  product_id: string | null;
  product_slug: string | null;
  team_id: string;
  team_slug: string;
  wiki: ProjectWiki | Record<string, never>;
  config: Record<string, unknown>;
  notes: string | null;
};
export type AreaRule = {
  id: string;
  area_prefix: string;
  component_id: string;
  component_slug: string;
  component_name: string;
};
export type Repo = {
  id: string;
  slug: string;
  url: string;
  product_id: string | null;
  product_slug: string | null;
  source_slug: string | null;
  source_project_id: string | null;
  project_key: string | null;
  component_id: string | null;
  component_slug: string | null;
  default_branch: string;
  config: Record<string, unknown>;
  index_status: "idle" | "cloning" | "indexing" | "ready" | "error";
  indexed_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
};
export type Discovered<K extends string, T> = { ok: boolean; error?: string } & {
  [P in K]?: T[];
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
  project:
    "One project as its source knows it — an Azure DevOps project, a Freshdesk group, a GitHub owner/repo. Registering it is what tells tachy where its items, wiki and code belong.",
  role: "knowledge: bound to a product — its items become knowledge, and it can own a wiki, repos and area rules. tracker: no product, just a place we create and reassign work items in.",
  area: "Azure DevOps area path prefix. Items under it are filed on this component automatically; the longest matching prefix wins.",
  repoComponent:
    "The component this repo implements. Code search can then be narrowed to it, so a question about one part of the product searches that repo instead of everything.",
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
