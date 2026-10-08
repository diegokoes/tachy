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
} from "@tachy/core/access";
import { env, log } from "@tachy/core/infra";
import { type UserRole } from "@tachy/core";
import { failureThrottle } from "./throttle";

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
    const ephemeral = randomBytes(32).toString("hex");
    log("warn", "session_secret_missing", {
      detail:
        "TACHY_SESSION_SECRET unset: using an ephemeral secret, sessions reset on restart",
    });
    return ephemeral;
  })();

/**
 * Behind a TLS-terminating proxy, which is how this is deployed, the request
 * the app sees is plain http, so the URL alone would drop `Secure`. The
 * forwarded header is the proxy's statement about the leg the browser made.
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

const logins = failureThrottle(5);

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
 * No identity is a refusal. Every mount point sits behind the `/api/*`
 * middleware that guarantees one, and this does not fail open where one is
 * mounted outside it.
 */
export async function requireAdmin(c: Context, next: Next): Promise<void> {
  if (getIdentity(c)?.role !== "admin")
    throw new HTTPException(403, { message: "app admin role required" });
  await next();
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Registered before any route that needs to know who is calling - including
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
  const { oidc, passwordAuth } = opts;

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
        if (logins.blocked(email))
          return c.json({ error: "too many attempts; wait a minute" }, 429);
        const user = await getUserByEmail(email);
        const ok =
          user &&
          !user.disabled &&
          (await verifyPassword(password, user.password_hash));
        if (!ok) {
          logins.fail(email);
          return c.json({ error: "invalid email or password" }, 401);
        }
        if (oidc && !user.password_login_allowed)
          return c.json(
            { error: "this account signs in with SSO; password login is off" },
            403,
          );
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
