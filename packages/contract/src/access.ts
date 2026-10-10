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

/** Starts every API token, so a bearer says which kind it is before a lookup. */
export const API_TOKEN_PREFIX = "tachy_pat_";

/** The lifetimes the token form offers, in days. */
export const TOKEN_LIFETIME_DAYS = [30, 90, 365] as const;

/** What a token gets when nobody chose: one that never expires is asked for. */
export const DEFAULT_TOKEN_DAYS = 90;

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
