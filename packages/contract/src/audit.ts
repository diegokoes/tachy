/** What the audit trail records. A new recorded action is added here first. */
export const AUDIT_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "setup",
  "user_create",
  "user_update",
  "team_member_set",
  "credential_set",
  "credential_delete",
  "source_connection_save",
  "source_connection_delete",
  "setting_set",
  "maintenance_set",
  "bucket_create",
  "bucket_delete",
  "bucket_token_rotate",
  "output_download",
  "export",
  "catalog_add",
  "api_token_mint",
  "api_token_revoke",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEventRow {
  /** A bigint, as text. Larger is later; it is also the paging cursor. */
  id: string;
  at: string;
  /** Null for an action nobody was signed in for, such as a failed login. */
  actor_email: string | null;
  /** The door the action came through: web, api, agent, mcp. */
  actor: string;
  action: AuditAction;
  target: string | null;
  detail: Record<string, unknown>;
  address: string | null;
}
