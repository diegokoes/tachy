import type { TeamRole } from "@tachy/contract";
import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { Member, SystemInfo, Team, UserRow } from "./rows";

export type Membership = {
  user_id: string;
  team_slug: string;
  team_name: string;
  team_role: TeamRole;
};

/**
 * Who exists, which teams they are in, and how sign-in is configured.
 *
 * Module singletons rather than per-panel resources: the users list, the team
 * roster and the app-admin list are three views of the same three endpoints,
 * and they sit on one page at once. Fetching them per panel meant the same
 * query three times on every visit.
 */
export const users = createResource(() => api.get<UserRow[]>("/users"), []);
export const teams = createResource(() => api.get<Team[]>("/teams"), []);
export const memberships = createResource(
  () => api.get<Membership[]>("/users/memberships"),
  [] as Membership[],
);

/**
 * Only for `security.sso_configured`, which decides what a password column
 * means. `runtime` is app-admin only, so a team admin reads `null` here and
 * the sign-in columns say so rather than guessing.
 */
export const system = createResource(
  () => api.get<SystemInfo | null>("/system"),
  null as SystemInfo | null,
);

export const reloadRoster = () =>
  Promise.all([users.reload(), teams.reload(), memberships.reload()]);

/** Whether single sign-on is set up, or null when the caller cannot see. */
export const ssoConfigured = (): boolean | null =>
  system.data?.runtime?.security.sso_configured ?? null;

/**
 * How this account can actually sign in.
 *
 * Under SSO a password only works for accounts explicitly allowed one (that
 * is what `password_login_allowed` is for), so holding a hash is not the same
 * as being able to use it.
 */
export function signIn(u: UserRow, sso: boolean | null) {
  return {
    password: u.has_password && (sso !== true || u.password_login_allowed),
    /* SSO is a deployment-wide setting, so it is on for everyone or no one.
       Service accounts authenticate with a token instead. */
    sso: sso === true && !u.service_account,
  };
}

export const teamsOf = (u: UserRow, all: Membership[]) =>
  all.filter((m) => m.user_id === u.id);

export const membersOf = (teamSlug: string, all: Membership[]) =>
  all.filter((m) => m.team_slug === teamSlug);

export type { Member, Team, UserRow };
