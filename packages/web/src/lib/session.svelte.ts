// Auth/session state for the SPA: who is logged in, what login methods the
// server offers, and whether the instance has been set up at all. /auth/* and
// /api/setup/status live outside /api, so raw fetch (no api.ts) on purpose.

export interface Me {
  email: string | null;
  name: string | null;
  role: "admin" | "member";
  via: "password" | "sso" | "open";
}

export interface AuthConfig {
  authMode: string;
  sso: boolean;
  passwordLogin: boolean;
}

export const session = $state<{
  loading: boolean;
  me: Me | null;
  config: AuthConfig | null;
  bootstrapped: boolean | null;
}>({ loading: true, me: null, config: null, bootstrapped: null });

export async function initSession(): Promise<void> {
  session.loading = true;
  try {
    const [cfgRes, statusRes, meRes] = await Promise.all([
      fetch("/auth/config"),
      fetch("/api/setup/status"),
      fetch("/auth/me"),
    ]);
    session.config = cfgRes.ok ? await cfgRes.json() : null;
    session.bootstrapped = statusRes.ok ? (await statusRes.json()).bootstrapped : null;
    session.me = meRes.ok ? await meRes.json() : null;
  } catch {
    session.config = null;
  } finally {
    session.loading = false;
  }
}

// Called by the api clients on a 401. With password login available the in-app
// login screen takes over; a pure-SSO deployment bounces to the IdP instead.
export function onUnauthorized(): void {
  if (session.config?.sso && !session.config.passwordLogin) {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  session.me = null;
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch("/auth/password/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `login failed (${res.status})`);
  session.me = { email: body.email, name: body.name ?? null, role: body.role, via: "password" };
  if (session.config) session.config.passwordLogin = true;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout");
  session.me = null;
  window.location.href = "/";
}
