import { Hono } from "hono";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { sql, AppError, registerSource, effectiveSettings } from "@tachy/core";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { knowledge, analysisRuns } from "./routes/knowledge";
import { workItems } from "./routes/work-items";
import { admin } from "./routes/admin";
import { reference } from "./routes/reference";
import { agent } from "./routes/agent";
import { setup } from "./routes/setup";
import { users } from "./routes/users";
import { installAuth, isBootstrapped, type OidcConfig } from "./auth";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);

const STATUS_BY_CODE = {
  not_found: 404,
  conflict: 409,
  bad_input: 400,
  forbidden: 403,
} as const;

function apiRoutes() {
  return new Hono()
    .route("/work-items", workItems)
    .route("/knowledge", knowledge)
    .route("/analysis-runs", analysisRuns)
    .route("/reference", reference)
    .route("/agent", agent)
    .route("/users", users)
    .route("/", admin);
}

export function createApp(
  opts: {
    apiToken?: string;
    webRoot?: string;
    oidc?: OidcConfig;
    passwordAuth?: boolean;
  } = {},
) {
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

  const authMode = opts.oidc ? "sso" : opts.apiToken ? "token" : "open";
  base.get("/auth/config", async (c) => {
    let profile = "support";
    try {
      profile = (await effectiveSettings()).deployment_profile.value;
    } catch {}
    return c.json({
      authMode,
      sso: Boolean(opts.oidc),
      passwordLogin: Boolean(opts.passwordAuth) && (await isBootstrapped()),
      profile,
    });
  });

  base.route("/api/setup", setup);

  installAuth(base, {
    apiToken: opts.apiToken,
    oidc: opts.oidc,
    passwordAuth: opts.passwordAuth,
  });

  const app = base.route("/api", apiRoutes());

  if (opts.webRoot) {
    const root = opts.webRoot;
    app.use("/assets/*", serveStatic({ root }));
    const indexHandler = serveStatic({ path: "index.html", root });
    app.get("*", (c, next) =>
      c.req.path.startsWith("/api/") ? next() : indexHandler(c, next),
    );
  }

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof AppError)
      return c.json({ error: err.message }, STATUS_BY_CODE[err.code]);
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof z.ZodError)
      return c.json({ error: "validation failed", issues: err.issues }, 400);
    if (err instanceof SyntaxError)
      return c.json({ error: "invalid JSON body" }, 400);
    console.error(err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
