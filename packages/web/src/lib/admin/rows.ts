import type {
  AgentProvider,
  DeploymentProfile,
  TeamRole,
  UserRole,
} from "@tachy/contract";

/**
 * The shapes the admin panels render — one per table they administer, as the
 * API returns them.
 */
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
export type RuntimeInfo = {
  draining: boolean;
  refusingChats: boolean;
  readiness: {
    ready: boolean;
    database: boolean;
    schema: string;
    model: string;
    draining: boolean;
  };
  tableSizes: { table: string; bytes: number; rows: number }[];
  security: {
    sso_configured: boolean;
    users_with_password: number;
    password_login_under_sso: number;
    service_accounts: number;
  };
  uploadTtlHours: number;
  turns: {
    slotsUsed: number;
    slotCap: number;
    queued: number;
    rejectedSinceBoot: number;
    running: Record<string, number>;
    pendingApprovals: number;
    oldestApprovalAgeSeconds: number | null;
  };
  memory: {
    currentBytes: number;
    maxBytes: number | null;
    percent: number | null;
  } | null;
  eventLoopP99Ms: number;
  embed: {
    queries: number;
    passages: number;
    callers: number;
    running: boolean;
  } | null;
  postgres:
    | { max: number; byProcess: { name: string; state: string; n: number }[] }
    | { error: string };
  status: Record<string, unknown> | null;
};
export type SystemInfo = {
  settings: {
    redaction_global: Setting<boolean>;
    agent_provider: Setting<AgentProvider>;
    agent_model: Setting<string>;
    agent_effort: Setting<string>;
    allowed_models: Setting<string[]>;
    org_name: Setting<string | null>;
    deployment_profile: Setting<DeploymentProfile>;
    agent_slot_cap: Setting<number>;
    copilot_slot_weight: Setting<number>;
    agent_queue_max: Setting<number>;
  };
  credentials: {
    vault_enabled: boolean;
    anthropic_api_key: "global" | "env" | null;
    copilot_token: "global" | "env" | null;
  };
  /** Admin-only: the server withholds it from a member. */
  env?: {
    auth_mode: string;
    port: number;
    user_email: string | null;
    oidc_configured: boolean;
    api_token_set: boolean;
    session_secret_set: boolean;
    anthropic_api_key_set: boolean;
    copilot_token_set: boolean;
    env_badge: string | null;
    commit: string | null;
  };
  /** Admin-only: current values, nothing stored. */
  runtime?: RuntimeInfo;
};
export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  disabled: boolean;
  has_password: boolean;
  service_account: boolean;
  password_login_allowed: boolean;
  created_at: string;
};
export type Member = {
  user_id: string;
  email: string;
  display_name: string | null;
  team_role: TeamRole;
};

/**
 * `GET /overview` — the whole admin index in one request. `counts` and `warn`
 * badge the rail; `detail` is what the three overview panels render from.
 */
export type Census = {
  counts: Record<string, number>;
  warn: Record<string, number>;
  detail: {
    sources: {
      connections: number;
      projects: number;
      knowledge: number;
      trackers: number;
      projects_no_wiki: number;
      projects_for_customer: number;
      by_type: Record<string, number>;
      untokened: number;
      never_synced: number;
    };
    repos: {
      repos: number;
      failing: number;
      ready: number;
      working: number;
      idle: number;
      no_component: number;
      no_project: number;
      never_indexed: number;
      files: number;
      chunks: number;
      oldest_indexed_at: string | null;
    };
    catalog: {
      teams: number;
      products: number;
      components: number;
      labels: number;
      patterns: number;
      customers: number;
      teams_no_product: number;
      products_no_component: number;
      components_root: number;
      components_no_description: number;
      labels_no_description: number;
      patterns_no_description: number;
      customers_no_domains: number;
      customer_units: number;
      components_by_product: { slug: string; name: string; n: number }[];
    };
    users: {
      users: number;
      disabled: number;
      admins: number;
      team_admins: number;
      with_password: number;
      teams_with_admin: number;
      teams_without_admin: { slug: string; name: string }[];
      users_no_team: number;
    };
    knowledge: {
      entries: number;
      entries_no_component: number;
      entries_no_product: number;
      by_status: Record<string, number>;
    };
  };
};

/**
 * `GET /overview/activity` — what the deployment has been doing rather than
 * what it holds. The two lists that name people arrive only for an app admin.
 */
export type Activity = {
  usage: {
    days: number;
    turns: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    active_7d: number;
    active: number;
    per_day: { day: string; turns: number; tokens: number }[];
    by_model: { model: string; turns: number; tokens: number }[];
    top_users?: {
      email: string;
      turns: number;
      tokens: number;
      cost_usd: number;
    }[];
  };
  tools: {
    days: number;
    reads: number;
    writes: number;
    tools: {
      tool: string;
      writes: boolean;
      calls: number;
      failures: number;
      misuse: number;
    }[];
    writers?: { email: string; writes: number }[];
  };
  traffic: {
    days: number;
    connections: {
      slug: string;
      source_type: string;
      agent: number;
      sync: number;
      app: number;
      rate_limited: number;
      auth_failures: number;
      last_auth_failure: string | null;
    }[];
    per_day: { day: string; agent: number; sync: number; app: number }[];
  };
  library: {
    days: number;
    reads: number;
    readers: number;
    corrections: number;
    per_day: { day: string; reads: number }[];
    top: {
      id: string;
      kind: "entry" | "doc";
      title: string;
      reads: number;
      readers: number;
    }[];
  };
};

export type JsonSchema = {
  type?: string;
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};
export type JobKindInfo = {
  kind: string;
  title: string;
  description: string | null;
  connection: string | null;
  default_schedule: string | null;
  resource_class: "light" | "heavy";
  overlap: "skip" | "queue";
  missed: "run-once" | "skip";
  timeout: string;
  max_attempts: number;
  params_schema: JsonSchema;
};
export type JobRunRow = {
  id: string;
  definition_id: string | null;
  kind: string;
  params: Record<string, unknown>;
  resource_class: "light" | "heavy";
  trigger: string;
  status: string;
  attempts: number;
  max_attempts: number;
  progress: number | null;
  progress_note: string | null;
  error: string | null;
  log_tail: string;
  output: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type JobDefinitionRow = {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
  schedule: string | null;
  timezone: string;
  resource_class: "light" | "heavy" | null;
  timeout: string | null;
  overlap: "skip" | "queue" | null;
  notify: "failure" | "always" | "never";
  disabled_reason: string | null;
  next_run: string | null;
  last_run: {
    id: string;
    status: string;
    created_at: string;
    error: string | null;
  } | null;
};
export type JobChange = {
  id: string;
  action: string;
  changed_by: string | null;
  created_at: string;
};
