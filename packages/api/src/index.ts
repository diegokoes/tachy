import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import {
  backgroundSettled,
  embedQuery,
  env,
  log,
  sql,
  sweepInterruptedIndexes,
  sweepWikiGaps,
} from "@tachy/core";
import { createApp } from "./app";
import { isBootstrapped } from "./auth";
import { lifecycle } from "./lifecycle";
import { abortAllTurns, activeTurnCount } from "./routes/agent";

export { createApp } from "./app";
export type { AppType } from "./app";

const webRoot = process.env.TACHY_WEB_ROOT ?? "packages/web/dist";
const serveWeb = existsSync(webRoot);

const oidc =
  env.oidc && env.sessionSecret
    ? { ...env.oidc, sessionSecret: env.sessionSecret }
    : undefined;

const app = createApp({
  apiToken: env.apiToken,
  webRoot: serveWeb ? webRoot : undefined,
  oidc,
  passwordAuth: true,
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

lifecycle.modelRequired = true;
embedQuery("warmup")
  .then(() => {
    lifecycle.modelReady = true;
    log("info", "embedding_model_ready", {});
  })
  .catch((err) => {
    log("error", "embedding_model_failed", { error: String(err) });
    process.exit(1);
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

/* Here rather than beside the routes, so it runs in the server and not in every
   test that builds an app. Once at boot, then hourly; an edit made through the
   wiki routes rescans its own wiki straight away, so this is what catches the
   rest — lessons recorded by the agent, entries approved elsewhere. */
const WIKI_GAP_SWEEP_MS = 60 * 60_000;
const sweepGaps = () =>
  sweepWikiGaps()
    .then((r) => log("info", "wiki_gap_sweep", { ...r }))
    .catch((err) => log("error", "wiki_gap_sweep", { error: String(err) }));
void sweepGaps();
setInterval(sweepGaps, WIKI_GAP_SWEEP_MS).unref();
