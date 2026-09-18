import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import {
  backgroundSettled,
  env,
  log,
  setEmbedBackend,
  sql,
  startEmbedHost,
  sweepInterruptedIndexes,
  startJobProcess,
} from "@tachy/core";
import { createApp } from "./app";
import { isBootstrapped } from "./auth";
import { setInternalEndpoint } from "./internal-endpoint";
import type { InternalOptions } from "./routes/internal";
import { lifecycle } from "./lifecycle";
import { setEmbedDepth } from "./runtime";
import { abortAllTurns, activeTurnCount } from "./routes/agent";

export { createApp } from "./app";
export type { AppType } from "./app";

const webRoot = process.env.TACHY_WEB_ROOT ?? "packages/web/dist";
const serveWeb = existsSync(webRoot);

const oidc =
  env.oidc && env.sessionSecret
    ? { ...env.oidc, sessionSecret: env.sessionSecret }
    : undefined;

/* With TACHY_EMBED_URL the model lives in the embedder service and this process,
   its MCP children and the workers all embed over HTTP with the shared secret.
   Without it, the model runs in a worker thread here and the children reach it
   through this process with a per-boot secret. */
const externalEmbedder = process.env.TACHY_EMBED_URL;
const internalSecret =
  process.env.TACHY_INTERNAL_SECRET || randomBytes(32).toString("hex");
let embed: InternalOptions["embed"] | undefined;
if (externalEmbedder) {
  lifecycle.embedderUrl = new URL("/readyz", externalEmbedder).toString();
} else {
  lifecycle.modelRequired = true;
  const embedder = startEmbedHost({
    onReady: (ready) => (lifecycle.modelReady = ready),
    onFatal: (err) => {
      log("error", "embedding_model_failed", { error: String(err) });
      process.exit(1);
    },
  });
  embed = embedder.queue.embed.bind(embedder.queue);
  setEmbedBackend(embed);
  setEmbedDepth(() => embedder.queue.depth);
  process.once("exit", () => void embedder.stop());
}
setInternalEndpoint({
  baseUrl: `http://127.0.0.1:${env.port}/internal`,
  embedUrl: externalEmbedder,
  secret: internalSecret,
});

const app = createApp({
  apiToken: env.apiToken,
  webRoot: serveWeb ? webRoot : undefined,
  oidc,
  passwordAuth: true,
  internal: {
    secret: internalSecret,
    embed:
      embed ??
      (async () => {
        throw new Error("embedding is served by TACHY_EMBED_URL");
      }),
  },
});

const swept = await sweepInterruptedIndexes();
if (swept) log("info", "repo_index_sweep", { interrupted: swept });

const authConfigured =
  Boolean(env.apiToken || oidc) || (await isBootstrapped());
if (!authConfigured) {
  log("warn", "auth_unconfigured", {
    detail:
      "no auth configured yet. Binding to 127.0.0.1 only; open the web UI to run the setup wizard (or set TACHY_API_TOKEN / OIDC_*), then restart to accept remote requests.",
  });
}
const server = serve({
  fetch: app.fetch,
  port: env.port,
  hostname: authConfigured ? undefined : "127.0.0.1",
});

const DRAIN_MS = (Number(process.env.TACHY_DRAIN_SECONDS) || 180) * 1000;

/**
 * Stop taking turns, give the running ones the drain period, then close. The
 * container's stop_grace_period must exceed TACHY_DRAIN_SECONDS, or Docker
 * SIGKILLs the turns this is waiting for.
 */
async function drain(signal: string) {
  if (lifecycle.draining) return;
  lifecycle.draining = true;
  log("info", "drain_start", { signal, turns: activeTurnCount() });

  const deadline = Date.now() + DRAIN_MS;
  while (activeTurnCount() > 0 && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 500));
  const aborted = abortAllTurns();
  await jobWorker?.drain(Math.max(0, deadline - Date.now()));

  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
  await Promise.race([
    backgroundSettled(),
    new Promise((r) => setTimeout(r, 5_000)),
  ]);
  await sql.end({ timeout: 5 });
  log("info", "drain_done", { aborted });
  process.exit(0);
}
process.once("SIGTERM", () => void drain("SIGTERM"));
process.once("SIGINT", () => void drain("SIGINT"));
console.log(
  `tachy api listening on :${env.port} [auth=${env.authMode}]${serveWeb ? ` (serving SPA from ${webRoot})` : ""}`,
);

/* Jobs run in a dedicated worker service in production (TACHY_WORKER=external).
   Without one, this process works every class itself, so a single `npm run api`
   still syncs, reindexes and sweeps. */
const jobWorker =
  process.env.TACHY_WORKER === "external"
    ? null
    : await startJobProcess({ classes: ["light", "heavy"], concurrency: 1 });
