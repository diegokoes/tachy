import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  initOidcAuthMiddleware,
  oidcAuthMiddleware,
  getAuth,
  revokeSession,
} from "@hono/oidc-auth";
import { upsertUser } from "@tachy/core";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes?: string;
  sessionSecret: string;
}

// Timing-safe bearer comparison for the automation token.
function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Resolve the interactive user's email for the current request, if any (SSO session).
// Returns undefined for token/automation or unauthenticated requests. Callers use it
// to attribute actions (e.g. the agent passes it to the MCP server as TACHY_USER_EMAIL).
export async function sessionEmail(c: Parameters<typeof getAuth>[0]): Promise<string | undefined> {
  try {
    const auth = await getAuth(c);
    return auth?.email;
  } catch {
    return undefined;
  }
}

// Install the composite auth layer on the base app:
//  - When OIDC is configured: interactive SSO login (/auth/*) with a session cookie.
//  - The /api/* guard accepts EITHER a valid session (interactive) OR the bearer
//    token (automation). Neither → 401 (the SPA turns that into an /auth/login bounce).
//  - When neither is configured (open mode), no guard is installed.
// Must be called before the /api routes and static handler are mounted so the
// middleware wraps them.
export function installAuth(base: Hono, opts: { apiToken?: string; oidc?: OidcConfig }): void {
  const { apiToken, oidc } = opts;

  if (oidc) {
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

    // Interactive login: unauthenticated hits redirect to the IdP; on return the
    // session is set and we bounce to the requested app route.
    base.get("/auth/login", oidcAuthMiddleware(), (c) => c.redirect(c.req.query("redirect") || "/"));

    // The IdP redirects here; oidcAuthMiddleware processes the code exchange and
    // sets the session cookie, then redirects to the pre-login URL.
    base.get("/auth/callback", oidcAuthMiddleware(), (c) => c.redirect("/"));

    base.get("/auth/logout", async (c) => {
      await revokeSession(c);
      return c.redirect("/");
    });

    base.get("/auth/me", async (c) => {
      const auth = await getAuth(c);
      if (!auth?.email) return c.json({ error: "unauthenticated" }, 401);
      await upsertUser(auth.email, (auth.name as string | undefined) ?? undefined);
      return c.json({ email: auth.email, name: (auth.name as string | undefined) ?? null });
    });
  }

  if (apiToken || oidc) {
    base.use("/api/*", async (c, next) => {
      if (apiToken && tokenMatches(c.req.header("Authorization"), apiToken)) return next();
      if (oidc && (await sessionEmail(c))) return next();
      throw new HTTPException(401, { message: "unauthorized" });
    });
  }
}
