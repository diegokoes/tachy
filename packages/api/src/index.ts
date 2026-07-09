import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { env } from "@tachy/core";
import { createApp } from "./app";
import { isBootstrapped } from "./auth";

export { createApp } from "./app";
export type { AppType } from "./app";



const webRoot = process.env.TACHY_WEB_ROOT ?? "packages/web/dist";
const serveWeb = existsSync(webRoot);

const oidc = env.oidc && env.sessionSecret ? { ...env.oidc, sessionSecret: env.sessionSecret } : undefined;

const app = createApp({
  apiToken: env.apiToken,
  webRoot: serveWeb ? webRoot : undefined,
  oidc,
  passwordAuth: true,
});




const authConfigured = Boolean(env.apiToken || oidc) || (await isBootstrapped());
if (!authConfigured) {
  console.warn(
    "WARNING: no auth configured yet. Binding to 127.0.0.1 only; open the web UI to run the setup wizard (or set TACHY_API_TOKEN / OIDC_*), then restart to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: authConfigured ? undefined : "127.0.0.1" });
console.log(
  `tachy api listening on :${env.port} [auth=${env.authMode}]${serveWeb ? ` (serving SPA from ${webRoot})` : ""}`,
);
