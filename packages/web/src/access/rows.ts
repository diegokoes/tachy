import type { TeamRole, UserRole } from "@tachy/contract";

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  disabled: boolean;
  /** How the account signs in. Sent only to someone who curates a team or the app. */
  has_password?: boolean;
  service_account?: boolean;
  password_login_allowed?: boolean;
  created_at: string;
};
export type Member = {
  user_id: string;
  email: string;
  display_name: string | null;
  team_role: TeamRole;
};
