import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { log, startEmbedHost } from "@tachy/core";
import { internalRoutes } from "./routes/internal";

/*
 * The embedding service (DEPLOYMENT-ARCHITECTURE.md §5.4, Phase 2): the one copy
 * of the model on the host, for the api, its MCP children and the workers.
 * Reachable only on the Compose network, and every embed needs the shared
 * TACHY_INTERNAL_SECRET.
 */
const secret = process.env.TACHY_INTERNAL_SECRET;
if (!secret || secret.length < 32)
  throw new Error("TACHY_INTERNAL_SECRET (32+ characters) is required");

let ready = false;
const host = startEmbedHost({
  onReady: (r) => (ready = r),
  onFatal: (err) => {
    log("error", "embedding_model_failed", { error: String(err) });
    process.exit(1);
  },
});

const app = new Hono()
  .get("/livez", (c) => c.json({ ok: true }))
  .get("/readyz", (c) =>
    c.json({ ready, depth: host.queue.depth }, ready ? 200 : 503),
  )
  .route(
    "/internal",
    internalRoutes({ secret, embed: host.queue.embed.bind(host.queue) }),
  );

const port = Number(process.env.TACHY_EMBEDDER_PORT) || 8790;
const server = serve({ fetch: app.fetch, port });
log("info", "embedder_listening", { port });

async function stop() {
  server.close();
  await host.stop();
  process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
