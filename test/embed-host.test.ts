import { afterAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  embedQuery,
  setEmbedBackend,
  startEmbedHost,
  type EmbedHost,
} from "@tachy/core";
import { internalEmbed } from "../packages/api/src/routes/internal-embed";

let host: EmbedHost | undefined;
afterAll(async () => {
  setEmbedBackend(undefined);
  delete process.env.TACHY_EMBED_URL;
  delete process.env.TACHY_EMBED_SECRET;
  await host?.stop();
});

const ready = (h: EmbedHost) =>
  new Promise<void>((resolve) => {
    const tick = () =>
      h.queue
        .embed("query", ["ping"])
        .then(() => resolve())
        .catch(() => setTimeout(tick, 200));
    tick();
  });

describe("embedding in a worker thread", () => {
  it("returns the same vector as the in-process model", async () => {
    const local = await embedQuery("printer queue stalls after reboot");
    host = startEmbedHost({});
    await ready(host);
    const [threaded] = await host.queue.embed("query", [
      "printer queue stalls after reboot",
    ]);
    expect(threaded).toHaveLength(local.length);
    local.forEach((v, i) => expect(threaded[i]).toBeCloseTo(v, 5));
  }, 60_000);

  it("serves MCP children over the internal endpoint", async () => {
    const secret = "s".repeat(64);
    const app = new Hono().route(
      "/internal",
      internalEmbed({ secret, embed: host!.queue.embed.bind(host!.queue) }),
    );
    const server = serve({ fetch: app.fetch, port: 0 });
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };
    const url = `http://127.0.0.1:${port}/internal/embed`;
    try {
      const refused = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: JSON.stringify({ kind: "query", texts: ["x"] }),
      });
      expect(refused.status).toBe(401);

      const local = await embedQuery("vpn drops every hour");
      setEmbedBackend(undefined);
      process.env.TACHY_EMBED_URL = url;
      process.env.TACHY_EMBED_SECRET = secret;
      const remote = await embedQuery("vpn drops every hour");
      local.forEach((v, i) => expect(remote[i]).toBeCloseTo(v, 5));
    } finally {
      setEmbedBackend(undefined);
      delete process.env.TACHY_EMBED_URL;
      delete process.env.TACHY_EMBED_SECRET;
      server.close();
    }
  }, 60_000);
});
