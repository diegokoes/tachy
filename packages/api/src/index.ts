import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { env } from "@tachy/core";
import { createApp } from "./app";

export { createApp } from "./app";
export type { AppType } from "./app";

// Serve the built SPA if it exists (production / after `npm run web:build`). In
// pure frontend-dev, Vite serves the SPA and proxies here, so dist may be absent.
const webRoot = process.env.TACHY_WEB_ROOT ?? "packages/web/dist";
const serveWeb = existsSync(webRoot);

const oidc = env.oidc && env.sessionSecret ? { ...env.oidc, sessionSecret: env.sessionSecret } : undefined;

const app = createApp({
  apiToken: env.apiToken,
  webRoot: serveWeb ? webRoot : undefined,
  oidc,
});

// Bind to all interfaces when any auth is configured (SSO or token); otherwise
// (open mode) stay on loopback so an unauthenticated instance isn't exposed.
const authConfigured = Boolean(env.apiToken || oidc);
if (!authConfigured) {
  console.warn(
    "WARNING: no auth configured (authMode=open). Binding to 127.0.0.1 only; set TACHY_API_TOKEN or OIDC_* to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: authConfigured ? undefined : "127.0.0.1" });
console.log(
  `tachy api listening on :${env.port} [auth=${env.authMode}]${serveWeb ? ` (serving SPA from ${webRoot})` : ""}`,
);
