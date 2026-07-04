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

// Email of the SSO session user, if any; undefined for token/unauthenticated.
// Used for attribution (e.g. passed to the MCP server as TACHY_USER_EMAIL).
export async function sessionEmail(c: Parameters<typeof getAuth>[0]): Promise<string | undefined> {
  try {
    const auth = await getAuth(c);
    return auth?.email;
  } catch {
    return undefined;
  }
}

// Composite auth: /api/* accepts a session (SSO) OR the bearer token; neither
// configured = open mode with no guard. Must be installed before the /api routes
// are mounted so the middleware wraps them.
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

    base.get("/auth/login", oidcAuthMiddleware(), (c) => c.redirect(c.req.query("redirect") || "/"));
    // IdP redirect target; the middleware does the code exchange + session cookie.
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
