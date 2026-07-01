import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
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
    .route("/", admin);
}

// Build the app. Pure (no listen) so tests can drive it with app.request(). The
// bearer token is passed in rather than read from env, so auth is testable too.
// `webRoot` (optional) points at the built SPA (packages/web/dist); when set, the
// app serves static assets + an index.html SPA fallback for non-API routes.
export function createApp(opts: { apiToken?: string; webRoot?: string } = {}) {
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

  // Auth guards the data plane (/api/*) only — the SPA shell and static assets
  // stay public so the app can load and present a login. Browsers can't attach a
  // bearer to asset requests, so scoping the guard to /api is required for a web UI.
  if (opts.apiToken) {
    const guard = bearerAuth({ token: opts.apiToken });
    base.use("/api/*", guard);
  }

  const app = base.route("/api", apiRoutes());

  // Static SPA hosting. Assets first; anything else falls back to index.html so
  // client-side routes deep-link correctly. Placed after /api so it never shadows
  // the data routes.
  if (opts.webRoot) {
    const root = opts.webRoot;
    app.use("/assets/*", serveStatic({ root }));
    const indexHandler = serveStatic({ path: "index.html", root });
    // SPA fallback for client-side routes. /api/* is excluded so an unknown data
    // route still returns a JSON 404 (via notFound) instead of the HTML shell.
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
