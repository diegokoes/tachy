import { Hono, type Context, type Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { env, AppError, errorText, maskSecrets } from "@tachy/core/infra";
import { registerSource } from "@tachy/core/sources";
import { registerCoreJobs } from "@tachy/core/jobs";
import { effectiveSettings } from "@tachy/core/config";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";
import { knowledge, analysisRuns } from "./routes/knowledge";
import { workItems } from "./routes/work-items";
import { compose } from "./routes/compose";
import { flows } from "./routes/flows";
import { admin } from "./routes/admin";
import { reference } from "./routes/reference";
import { agent } from "./routes/agent";
import { setup } from "./routes/setup";
import { users } from "./routes/users";
import { me } from "./routes/me";
import { reports } from "./routes/reports";
import { preferences } from "./routes/preferences";
import { artifacts } from "./routes/artifacts";
import { outputs } from "./routes/outputs";
import { repos } from "./routes/repos";
import { wiki } from "./routes/wiki";
import { jobs } from "./routes/jobs";
import { auditTrail } from "./routes/audit";
import { diagnostics } from "./routes/diagnostics";
import { sourceProjects } from "./routes/source-projects";
import { initOidc, installAuth, isBootstrapped, type OidcConfig } from "./auth";
import { httpLogger, noteError } from "./logging";
import { readiness } from "./lifecycle";
import { internalRoutes, type InternalOptions } from "./routes/internal";
import { ingest } from "./routes/ingest";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);
registerCoreJobs();

const STATUS_BY_CODE = {
  not_found: 404,
  conflict: 409,
  bad_input: 400,
  forbidden: 403,
  unavailable: 503,
} as const;

function apiRoutes() {
  return new Hono()
    .route("/work-items", workItems)
    .route("/compose", compose)
    .route("/flows", flows)
    .route("/knowledge", knowledge)
    .route("/analysis-runs", analysisRuns)
    .route("/reference", reference)
    .route("/agent", agent)
    .route("/users", users)
    .route("/me", me)
    .route("/reports", reports)
    .route("/preferences", preferences)
    .route("/artifacts", artifacts)
    .route("/outputs", outputs)
    .route("/repos", repos)
    .route("/library", wiki)
    .route("/jobs", jobs)
    .route("/audit", auditTrail)
    .route("/tests", diagnostics)
    .route("/", sourceProjects)
    .route("/", admin);
}

/**
 * An HTTPException carries its own response, whose body is whatever message it
 * was thrown with.
 */
export async function withSecretsMasked(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(maskSecrets(await response.text()), {
    status: response.status,
    headers,
  });
}

/**
 * What the browser may load and do on a page this server sent. Scripts come
 * from this origin only, so markup that got past the sanitizer still cannot
 * run one. Styles allow inline because components set `style` attributes.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const RESPONSE_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** Set here and not in the proxy, so a deployment without one has them too. */
async function responseHeaders(c: Context, next: Next): Promise<void> {
  await next();
  // A route that sets its own, such as the stricter policy on a wiki asset, wins.
  for (const [name, value] of Object.entries(RESPONSE_HEADERS))
    if (!c.res.headers.has(name)) c.res.headers.set(name, value);
}

function isLoopback(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address ?? "";
    return address === "::1" || /^(::ffff:)?127\./.test(address);
  } catch {
    return false;
  }
}

export function createApp(
  opts: {
    apiToken?: string;
    webRoot?: string;
    oidc?: OidcConfig;
    passwordAuth?: boolean;
    internal?: InternalOptions;
  } = {},
) {
  const base = new Hono();
  base.use("*", requestId());
  base.use("*", httpLogger);
  base.use("*", responseHeaders);

  const livez = (c: Context) => c.json({ ok: true });
  base.get("/livez", livez);
  base.get("/health", livez);
  if (opts.internal) base.route("/internal", internalRoutes(opts.internal));
  base.route("/ingest", ingest);
  // The status code is all a probe needs. Which part is not ready describes
  // the deployment, so it goes only to a caller on the host itself.
  base.get("/readyz", async (c) => {
    const report = await readiness();
    return c.json(
      isLoopback(c) ? report : { ready: report.ready },
      report.ready ? 200 : 503,
    );
  });

  const tokenMode = opts.apiToken ? "token" : "open";
  const authMode = opts.oidc ? "sso" : tokenMode;
  base.get("/auth/config", async (c) => {
    let profile = "support";
    try {
      profile = (await effectiveSettings()).deployment_profile.value;
    } catch {}
    return c.json({
      authMode,
      sso: Boolean(opts.oidc),
      passwordLogin: Boolean(opts.passwordAuth) && (await isBootstrapped()),
      envBadge: env.envBadge ?? null,
      profile,
    });
  });

  // Ahead of installAuth's `/api/*` guard: a fresh install has no identity to
  // check yet. initOidc still runs first, so the wizard can tell an operator
  // already holding an SSO session from a stranger.
  if (opts.oidc) initOidc(base, opts.oidc);
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
    if (err instanceof AppError) {
      const error = errorText(err);
      noteError(c, { error, code: err.code });
      return c.json({ error }, STATUS_BY_CODE[err.code]);
    }
    if (err instanceof HTTPException) {
      noteError(c, { error: err.message });
      return withSecretsMasked(err.getResponse());
    }
    if (err instanceof z.ZodError) {
      noteError(c, { error: "validation failed", issues: err.issues });
      return c.json({ error: "validation failed", issues: err.issues }, 400);
    }
    if (err instanceof SyntaxError) {
      noteError(c, { error: "invalid JSON body" });
      return c.json({ error: "invalid JSON body" }, 400);
    }
    noteError(c, {
      error: errorText(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
