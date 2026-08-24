import { validateCredential } from "@tachy/contract";
import type { AgentProvider } from "@tachy/contract";

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
  email_domains: string[] | null;
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
  type?: string;
  root_path?: string;
  /** The one every wiki tool uses when none is named. Exactly one per project. */
  default?: boolean;
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
  customer_id: string | null;
  customer_slug: string | null;
  wikis: ProjectWiki[];
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
  customer_id: string | null;
  customer_slug: string | null;
  default_branch: string;
  config: Record<string, unknown>;
  index_status: "idle" | "cloning" | "indexing" | "ready" | "error";
  indexed_commit: string | null;
  index_error: string | null;
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
};
export type Discovered<K extends string, T> = {
  ok: boolean;
  error?: string;
} & {
  [P in K]?: T[];
};
export type Setting<T> = { value: T; source: "db" | "env" | "default" };
export type SystemInfo = {
  settings: {
    redaction_global: Setting<boolean>;
    agent_provider: Setting<AgentProvider>;
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

/** The phrase under the control. Anything longer belongs in INFO. */
export const TIP = {
  slug: "machine id, from the name",
  /* Three tables carry aliases and they do not all mean the same thing —
     a customer's are email domains, not names. See catalog/customers.ts. */
  aliases: {
    product: 'portal, "the web app" — comma-separated',
    component: 'lc, LC, "line controller" — comma-separated',
    customer: "other trading names — comma-separated",
  },
  emailDomains: "acme.com, acme.co.uk — comma-separated",
  parent: "parent in the hierarchy",
  team: "owning team",
  project: "the project as its source knows it",
  area: "Azure DevOps area path prefix",
  repoComponent: "narrows code search to this part",
};

/** The rules behind a field, shown on the info mark beside its label. */
export const INFO = {
  slug: "Stable lowercase machine id, derived from the name. Filters, URLs and the agent go through it.",
  aliases: {
    product:
      "Other names this product answers to. The agent and the API resolve them like the slug.",
    component:
      "Other names this component answers to. They also match knowledge and reference entries tagged with the variant.",
    customer:
      "Other NAMES this account trades under (Oettinger Davidoff). Not email domains — those have their own field.",
  },
  emailDomains:
    "Domains whose senders are this customer, including a partner or distributor who raises tickets on their behalf. Incoming tickets are attributed by the requester's domain — and a domain listed on two customers deliberately matches neither, so a shared integrator's domain belongs to nobody.",
  parent:
    "product_area paths (Product / Parent / Component) are derived from it.",
  team: "One team can own many products.",
  project:
    "One project as its source knows it — an Azure DevOps project, a Freshdesk group, a GitHub owner/repo. Registering it is what tells tachy where its items, wiki and code belong.",
  area: "Items under it are filed on this component automatically; the longest matching prefix wins.",
  repoComponent:
    "The component this repo implements. A question about one part of the product then searches that repo instead of everything.",
};

export const AGENT_KEY_LABELS: Record<string, string> = {
  anthropic_oauth_token: "Claude subscription token",
  anthropic_api_key: "Anthropic API key",
  copilot_token: "Copilot GitHub token",
};

/** The vault's own check, run in the field the key was typed into. */
export const agentKeyError = validateCredential;

export const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
