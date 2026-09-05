import type { DeploymentProfile } from "@tachy/contract";

export interface Me {
  email: string | null;
  name: string | null;
  role: "admin" | "member";
  via: "password" | "sso" | "open";

  team_admin?: { team_id: string; team_slug: string }[];
  teams?: { team_id: string; team_slug: string }[];
}

export interface AuthConfig {
  authMode: string;
  sso: boolean;
  passwordLogin: boolean;

  profile?: DeploymentProfile;
}

export const session = $state<{
  loading: boolean;
  me: Me | null;
  config: AuthConfig | null;
  bootstrapped: boolean | null;
  /** Set when boot could not reach the API at all, so the shell can say so. */
  unreachable: boolean;
}>({
  loading: true,
  me: null,
  config: null,
  bootstrapped: null,
  unreachable: false,
});

export async function initSession(): Promise<void> {
  session.loading = true;
  try {
    const [cfgRes, statusRes, meRes] = await Promise.all([
      fetch("/auth/config"),
      fetch("/api/setup/status"),
      fetch("/auth/me"),
    ]);
    session.config = cfgRes.ok ? await cfgRes.json() : null;
    session.bootstrapped = statusRes.ok
      ? (await statusRes.json()).bootstrapped
      : null;
    session.me = meRes.ok ? await meRes.json() : null;
    session.unreachable = false;
  } catch {
    /*
     * Every field, not just config: leaving `me` and `bootstrapped` at whatever
     * they held meant a boot with the API down rendered the whole app shell as
     * though the user were signed in.
     */
    session.config = null;
    session.me = null;
    session.bootstrapped = null;
    session.unreachable = true;
  } finally {
    session.loading = false;
  }
}

/**
 * Global admin. Treats "no session" as admin, matching the open-auth mode —
 * but not when boot failed, where "no session" means "we do not know".
 */
export function isGlobalAdmin(): boolean {
  if (session.unreachable) return false;
  return session.me?.role === "admin" || !session.me;
}

export function isCurator(): boolean {
  const me = session.me;
  return !!me && (me.role === "admin" || (me.team_admin?.length ?? 0) > 0);
}

export function canCurateScope(scope: {
  team_id?: string | null;
  team_slug?: string | null;
}): boolean {
  const me = session.me;
  if (!me) return false;
  if (me.role === "admin") return true;
  const teams = me.team_admin ?? [];
  if (scope.team_id && teams.some((t) => t.team_id === scope.team_id))
    return true;
  if (scope.team_slug && teams.some((t) => t.team_slug === scope.team_slug))
    return true;
  return !scope.team_id && !scope.team_slug && teams.length > 0;
}

export function onUnauthorized(): void {
  if (session.config?.sso && !session.config.passwordLogin) {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  session.me = null;
  /*
   * With no interactive way back in — token or open mode — App renders no login
   * view, so clearing `me` alone left the shell up with no session and nothing
   * the user could do. Re-deriving the whole session is the honest answer: in
   * open mode it comes straight back, and otherwise the shell has current
   * config to render from.
   */
  if (!session.config?.passwordLogin && !session.config?.sso)
    void initSession();
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch("/auth/password/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `login failed (${res.status})`);
  session.me = {
    email: body.email,
    name: body.name ?? null,
    role: body.role,
    via: "password",
  };
  if (session.config) session.config.passwordLogin = true;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout");
  session.me = null;
  window.location.href = "/";
}
