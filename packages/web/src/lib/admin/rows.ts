import type {
  AgentProvider,
  AgentUsage,
  CatalogCensus,
  ComponentRow,
  CustomerRow,
  DeploymentProfile,
  JobCensus,
  JobDefinition,
  JobRun,
  KnowledgeCensus,
  LabelRow,
  LibraryEngagement,
  PatternRow,
  ProductRow,
  RepoCensus,
  RepoRow,
  SourceCensus,
  SourceConnectionRow,
  SourceTraffic,
  TeamRole,
  TeamRow,
  ToolUsage,
  UserCensus,
  UserRole,
} from "@tachy/contract";

/**
 * The shapes the admin panels render — one per table they administer, as the
 * API returns them.
 */
export type Team = TeamRow;
export type Product = ProductRow;
export type Component = ComponentRow;
export type Label = LabelRow;
export type Customer = CustomerRow;
export type Pattern = PatternRow;
export type Connection = SourceConnectionRow & {
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
export type Repo = RepoRow;
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
    vault: {
      enabled: boolean;
      current_key: string | null;
      by_key: { key_id: string | null; count: number; current: boolean }[];
    };
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
  /** The host scripts' `*.jsonl` results, oldest first. Absent from an older API. */
  history?: Record<string, Record<string, unknown>[]> | null;
  uptimeSeconds?: number;
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
    sources: SourceCensus & { untokened: number };
    repos: RepoCensus;
    catalog: CatalogCensus;
    users: UserCensus;
    knowledge: KnowledgeCensus;
  };
};

/**
 * `GET /overview/activity` — what the deployment has been doing rather than
 * what it holds. The two lists that name people arrive only for an app admin.
 */
export type Activity = {
  usage: AgentUsage;
  tools: ToolUsage;
  traffic: SourceTraffic;
  library: LibraryEngagement;
};

/** `GET /jobs/census` — what the workers have been doing. */
export type { JobCensus };

/** `GET /overview/issues` — per issue key, how many and the first few by name. */
export type Issues = Record<
  string,
  { n: number; items: { key: string; label: string }[] }
>;

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
export type JobRunRow = JobRun;
export type JobDefinitionRow = JobDefinition & {
  next_run: string | null;
  last_run: Pick<JobRun, "id" | "status" | "created_at" | "error"> | null;
};
export type JobChange = {
  id: string;
  action: string;
  changed_by: string | null;
  created_at: string;
};
