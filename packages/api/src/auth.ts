import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { setSignedCookie, getSignedCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  initOidcAuthMiddleware,
  oidcAuthMiddleware,
  getAuth,
  revokeSession,
} from "@hono/oidc-auth";
import {
  upsertUser,
  getUserByEmail,
  countAdmins,
  verifyPassword,
  teamAdminTeams,
  userTeams,
  env,
  log,
  type UserRole,
} from "@tachy/core";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes?: string;
  sessionSecret: string;
}

export interface Identity {
  email?: string;
  name?: string;
  role: UserRole;
  via: "token" | "password" | "sso" | "open";
}

export const sessionSecret: string =
  env.sessionSecret ??
  (() => {
    const s = randomBytes(32).toString("hex");
    log("warn", "session_secret_missing", {
      detail:
        "TACHY_SESSION_SECRET is not set — using an ephemeral secret; sessions reset on restart",
    });
    return s;
  })();

/**
 * Behind a TLS-terminating proxy — which is how this is deployed — the request
 * the app sees is plain http, so keying `Secure` off the URL alone drops the
 * flag on exactly the deployments that need it. The forwarded header is the
 * proxy's statement about the leg the browser actually made.
 */
function isHttps(c: Context): boolean {
  const forwarded = c.req.header("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return c.req.url.startsWith("https:");
}

const COOKIE = "tachy_session";
const SESSION_SECONDS = 7 * 24 * 3600;

export async function setSessionCookie(
  c: Context,
  email: string,
): Promise<void> {
  const value = `${Date.now() + SESSION_SECONDS * 1000}|${email}`;
  await setSignedCookie(c, COOKIE, value, sessionSecret, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_SECONDS,
    secure: isHttps(c),
  });
}

async function cookieEmail(c: Context): Promise<string | undefined> {
  const value = await getSignedCookie(c, sessionSecret, COOKIE);
  if (!value) return undefined;
  const sep = value.indexOf("|");
  const exp = Number(value.slice(0, sep));
  if (!Number.isFinite(exp) || exp < Date.now()) return undefined;
  return value.slice(sep + 1) || undefined;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function sessionEmail(c: Context): Promise<string | undefined> {
  const fromCookie = await cookieEmail(c);
  if (fromCookie) return fromCookie;
  try {
    const auth = await getAuth(c as Parameters<typeof getAuth>[0]);
    return auth?.email;
  } catch {
    return undefined;
  }
}

let bootstrappedCache = false;
export async function isBootstrapped(): Promise<boolean> {
  if (bootstrappedCache) return true;
  bootstrappedCache = (await countAdmins()) > 0;
  return bootstrappedCache;
}
export function markBootstrapped(): void {
  bootstrappedCache = true;
}

/**
 * Keyed on an address the caller chose, so it is only a throttle if it is also
 * bounded: without the sweep, failed logins against made-up addresses grow it
 * for as long as the process runs.
 */
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED_FAILURES = 10_000;

function throttled(email: string): boolean {
  const f = failures.get(email);
  return !!f && f.resetAt > Date.now() && f.count >= 5;
}

function recordFailure(email: string): void {
  const f = failures.get(email);
  if (!f || f.resetAt < Date.now())
    failures.set(email, { count: 1, resetAt: Date.now() + 60_000 });
  else f.count++;

  if (failures.size > MAX_TRACKED_FAILURES) {
    const now = Date.now();
    for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
    // Still full means every window is live — drop the oldest insertions, which
    // Map iterates first. Losing one is at worst a few extra tries for them.
    if (failures.size > MAX_TRACKED_FAILURES)
      for (const k of failures.keys()) {
        failures.delete(k);
        if (failures.size <= MAX_TRACKED_FAILURES) break;
      }
  }
}

async function resolveIdentity(
  c: Context,
  opts: { apiToken?: string; oidc?: OidcConfig; passwordAuth?: boolean },
): Promise<Identity | null> {
  if (
    opts.apiToken &&
    tokenMatches(c.req.header("Authorization"), opts.apiToken)
  )
    return { role: "admin", via: "token" };

  const email = await cookieEmail(c);
  if (email) {
    const user = await getUserByEmail(email);
    if (user && !user.disabled)
      return {
        email: user.email,
        name: user.display_name ?? undefined,
        role: user.role,
        via: "password",
      };
  }

  if (opts.oidc) {
    try {
      const auth = await getAuth(c as Parameters<typeof getAuth>[0]);
      if (auth?.email) {
        const user = await getUserByEmail(auth.email);
        if (user?.disabled) return null;
        return {
          email: auth.email,
          name: (auth.name as string | undefined) ?? undefined,
          role: user?.role ?? "member",
          via: "sso",
        };
      }
    } catch {}
  }

  const passwordGate = opts.passwordAuth && (await isBootstrapped());
  if (!opts.apiToken && !opts.oidc && !passwordGate)
    return { role: "admin", via: "open" };
  return null;
}

const IDENTITY_KEY = "tachyIdentity";

export function getIdentity(c: Context): Identity | undefined {
  return c.get(IDENTITY_KEY as never) as Identity | undefined;
}

/**
 * No identity is a refusal, not a pass. Every mount point today sits behind the
 * `/api/*` middleware that guarantees one, so the old `identity && …` form was
 * never wrong in practice — but it fails open the moment that stops being true.
 */
export async function requireAdmin(c: Context, next: Next): Promise<void> {
  if (getIdentity(c)?.role !== "admin")
    throw new HTTPException(403, { message: "admin role required" });
  await next();
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Registered before any route that needs to know who is calling — including
 * `/api/setup`, which sits outside the `/api/*` identity guard and still has to
 * tell an operator holding an SSO session from a stranger. Separate from
 * `installAuth` only because of that ordering.
 */
export function initOidc(base: Hono, oidc: OidcConfig): void {
  base.use(
    "*",
    initOidcAuthMiddleware({
      OIDC_ISSUER: oidc.issuer,
      OIDC_CLIENT_ID: oidc.clientId,
      OIDC_CLIENT_SECRET: oidc.clientSecret,
      OIDC_AUTH_SECRET: oidc.sessionSecret,
      OIDC_REDIRECT_URI: oidc.redirectUri ?? "/auth/callback",
      OIDC_SCOPES: oidc.scopes,
    }),
  );
}

export function installAuth(
  base: Hono,
  opts: { apiToken?: string; oidc?: OidcConfig; passwordAuth?: boolean },
): void {
  const { apiToken, oidc, passwordAuth } = opts;

  if (oidc) {
    base.get("/auth/login", oidcAuthMiddleware(), (c) =>
      c.redirect(c.req.query("redirect") || "/"),
    );
    base.get("/auth/callback", oidcAuthMiddleware(), (c) => c.redirect("/"));
  }

  if (passwordAuth) {
    base.post(
      "/auth/password/login",
      zValidator("json", loginSchema),
      async (c) => {
        const { email, password } = c.req.valid("json");
        if (throttled(email))
          return c.json({ error: "too many attempts — wait a minute" }, 429);
        const user = await getUserByEmail(email);
        const ok =
          user &&
          !user.disabled &&
          (await verifyPassword(password, user.password_hash));
        if (!ok) {
          recordFailure(email);
          return c.json({ error: "invalid email or password" }, 401);
        }
        await setSessionCookie(c, user.email);
        return c.json({
          email: user.email,
          name: user.display_name,
          role: user.role,
        });
      },
    );
  }

  base.get("/auth/logout", async (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    if (oidc) await revokeSession(c as Parameters<typeof revokeSession>[0]);
    return c.redirect("/");
  });

  base.get("/auth/me", async (c) => {
    const identity = await resolveIdentity(c, opts);
    if (!identity || identity.via === "token")
      return c.json({ error: "unauthenticated" }, 401);
    if (identity.via === "open")
      return c.json({
        email: env.userEmail ?? null,
        name: null,
        role: "admin",
        via: "open",
        team_admin: [],
        teams: [],
      });
    if (identity.via === "sso" && identity.email)
      await upsertUser(identity.email, identity.name);

    let teamAdmin: { team_id: string; team_slug: string }[] = [];
    let teams: { team_id: string; team_slug: string }[] = [];
    if (identity.email) {
      const user = await getUserByEmail(identity.email);
      if (user) {
        teamAdmin = await teamAdminTeams(user.id);
        teams = await userTeams(user.id);
      }
    }
    return c.json({
      email: identity.email,
      name: identity.name ?? null,
      role: identity.role,
      via: identity.via,
      team_admin: teamAdmin,
      teams,
    });
  });

  base.use("/api/*", async (c, next) => {
    const identity = await resolveIdentity(c, opts);
    if (!identity) throw new HTTPException(401, { message: "unauthorized" });
    c.set(IDENTITY_KEY as never, identity as never);
    return next();
  });
}
