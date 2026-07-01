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

const app = createApp({ apiToken: env.apiToken, webRoot: serveWeb ? webRoot : undefined });

if (!env.apiToken) {
  console.warn(
    "WARNING: TACHY_API_TOKEN is not set. Binding to 127.0.0.1 only; set a token to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: env.apiToken ? undefined : "127.0.0.1" });
console.log(`tachy api listening on :${env.port}${serveWeb ? ` (serving SPA from ${webRoot})` : ""}`);
