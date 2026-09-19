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
