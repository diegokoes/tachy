export interface UserCensus {
  users: number;
  disabled: number;
  admins: number;
  team_admins: number;
  with_password: number;
  teams_with_admin: number;
  teams_without_admin: { slug: string; name: string }[];
  users_no_team: number;
}

/**
 * Who a sign-in through the identity provider lets in: only accounts an admin
 * has added, or anyone the provider authenticates.
 */
export const SSO_ADMISSIONS = ["invited", "anyone"] as const;
export type SsoAdmission = (typeof SSO_ADMISSIONS)[number];

/** The `code` on the refusal of a sign-in nobody added an account for. */
export const NOT_INVITED = "not_invited";

/** Starts every API token, so a bearer says which kind it is before a lookup. */
export const API_TOKEN_PREFIX = "tachy_pat_";

export interface ApiTokenRow {
  id: string;
  name: string;
  /** The token's last characters; the token itself is shown once, at minting. */
  hint: string;
  created_at: string;
  last_used_at: string | null;
  /** Null: no expiry. */
  expires_at: string | null;
  revoked_at: string | null;
}
