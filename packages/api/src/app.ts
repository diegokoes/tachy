import { Hono } from "hono";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { sql, AppError, registerSource } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { knowledge, analysisRuns } from "./routes/knowledge";
import { workItems } from "./routes/work-items";
import { admin } from "./routes/admin";
import { reference } from "./routes/reference";
import { agent } from "./routes/agent";
import { installAuth, type OidcConfig } from "./auth";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const STATUS_BY_CODE = { not_found: 404, conflict: 409, bad_input: 400 } as const;

// The REST surface, mounted under /api so the SPA and API share one origin.
// Exported as a chained sub-app so `typeof apiRoutes` carries route types for an
// RPC client.
function apiRoutes() {
  return new Hono()
    .route("/work-items", workItems)
    .route("/knowledge", knowledge)
    .route("/analysis-runs", analysisRuns)
    .route("/reference", reference)
    .route("/agent", agent)
    .route("/", admin);
}

// Build the app. Pure (no listen) so tests can drive it with app.request(). Auth
// config is passed in rather than read from env, so it's testable. `webRoot`
// (optional) points at the built SPA (packages/web/dist); when set, the app serves
// static assets + an index.html SPA fallback for non-API routes.
export function createApp(opts: { apiToken?: string; webRoot?: string; oidc?: OidcConfig } = {}) {
  const base = new Hono();
  base.use("*", logger());

  base.get("/health", async (c) => {
    try {
      await sql`select 1`;
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  // Public: lets the SPA decide whether to show a Sign-in button. No secrets.
  const authMode = opts.oidc ? "sso" : opts.apiToken ? "token" : "open";
  base.get("/auth/config", (c) => c.json({ authMode }));

  // Auth (SSO session OR bearer) guards /api/* only: browsers can't attach a
  // bearer to asset requests, so the SPA shell must stay public. Also mounts /auth/*.
  installAuth(base, { apiToken: opts.apiToken, oidc: opts.oidc });

  const app = base.route("/api", apiRoutes());

  if (opts.webRoot) {
    const root = opts.webRoot;
    app.use("/assets/*", serveStatic({ root }));
    const indexHandler = serveStatic({ path: "index.html", root });
    // SPA fallback; /api/* excluded so unknown data routes return JSON 404, not HTML.
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : indexHandler(c, next)));
  }

  app.notFound((c) => c.json({ error: "not found" }, 404));

  // Single error boundary: map known failure shapes to proper status codes instead
  // of leaking a 500. AppError carries an explicit code, so no message regex needed.
  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, STATUS_BY_CODE[err.code]);
    if (err instanceof HTTPException) return err.getResponse(); // e.g. bearerAuth 401, malformed-JSON 400
    if (err instanceof z.ZodError) return c.json({ error: "validation failed", issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
    console.error(err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
