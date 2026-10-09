import type { DeploymentProfile } from "@tachy/contract";

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
  /** Null for a member: the server sends how the deployment is secured to an admin only. */
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
  } | null;
  uploadTtlHours: number;
  turns: {
    slotsUsed: number;
    slotCap: number;
    queued: number;
    rejectedSinceBoot: number;
    running: number;
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
    agent_model: Setting<string>;
    agent_effort: Setting<string>;
    allowed_models: Setting<string[]>;
    org_name: Setting<string | null>;
    deployment_profile: Setting<DeploymentProfile>;
    agent_slot_cap: Setting<number>;
    agent_queue_max: Setting<number>;
    org_timezone: Setting<string>;
  };
  credentials: {
    vault_enabled: boolean;
    anthropic_api_key: "global" | "env" | null;
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
    env_badge: string | null;
    commit: string | null;
  };
  /** Admin-only: current values, nothing stored. */
  runtime?: RuntimeInfo;
};
