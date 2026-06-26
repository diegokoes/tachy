import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sql, AppError, registerSource } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { knowledge, analysisRuns } from "./routes/knowledge";
import { workItems } from "./routes/work-items";
import { admin } from "./routes/admin";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const STATUS_BY_CODE = { not_found: 404, conflict: 409, bad_input: 400 } as const;

// Build the API. Pure (no listen) so tests can drive it with app.request(). The
// bearer token is passed in rather than read from env, so auth is testable too.
export function createApp(opts: { apiToken?: string } = {}) {
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

  // Bearer-token guard on everything except /health.
  if (opts.apiToken) {
    const guard = bearerAuth({ token: opts.apiToken });
    base.use("*", (c, next) => (c.req.path === "/health" ? next() : guard(c, next)));
  }

  const app = base
    .route("/work-items", workItems)
    .route("/knowledge", knowledge)
    .route("/analysis-runs", analysisRuns)
    .route("/", admin);

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
