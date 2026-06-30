import { serve } from "@hono/node-server";
import { env } from "@tachy/core";
import { createApp } from "./app";

export { createApp } from "./app";
export type { AppType } from "./app";

const app = createApp({ apiToken: env.apiToken });

if (!env.apiToken) {
  console.warn(
    "WARNING: TACHY_API_TOKEN is not set. Binding to 127.0.0.1 only; set a token to accept remote requests.",
  );
}
serve({ fetch: app.fetch, port: env.port, hostname: env.apiToken ? undefined : "127.0.0.1" });
console.log(`tachy api listening on :${env.port}`);
