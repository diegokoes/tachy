import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../../packages/api/src/app";
import { lifecycle, watchPool } from "../../packages/api/src/lifecycle";
import { json } from "../http";
import { sql } from "../database";

afterAll(() => sql.end());

const app = createApp();
const schemaHash = createHash("sha256")
  .update(readFileSync("db/schema.sql"))
  .digest("hex");

afterEach(async () => {
  Object.assign(lifecycle, {
    draining: false,
    modelRequired: false,
    modelReady: false,
  });
  await sql`delete from schema_meta`;
});

describe("probes", () => {
  it("answers /livez and keeps /health as its alias", async () => {
    for (const path of ["/livez", "/health"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it("is ready on a database that predates the schema stamp", async () => {
    const response = await app.request("/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ready: true,
      database: true,
      schema: "unstamped",
      model: "not_required",
    });
  });

  it("is ready when the stamp matches this schema.sql", async () => {
    await sql`insert into schema_meta (schema_sha256) values (${schemaHash})`;
    const body = await (await app.request("/readyz")).json();
    expect(body.schema).toBe("match");
    expect(body.ready).toBe(true);
  });

  it("is not ready when the database was built from another schema.sql", async () => {
    await sql`insert into schema_meta (schema_sha256) values ('0000')`;
    const response = await app.request("/readyz");
    expect(response.status).toBe(503);
    expect((await response.json()).schema).toBe("mismatch");
  });

  it("is not ready while the embedding model loads", async () => {
    lifecycle.modelRequired = true;
    expect((await app.request("/readyz")).status).toBe(503);
    lifecycle.modelReady = true;
    expect((await app.request("/readyz")).status).toBe(200);
  });
});

describe("draining", () => {
  it("fails readiness and refuses new chat turns with a retry hint", async () => {
    lifecycle.draining = true;
    expect((await app.request("/readyz")).status).toBe(503);

    const response = await app.request(
      "/api/agent/chat",
      json({ message: "hello" }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("follows an external embedder's readiness", async () => {
    const { serve } = await import("@hono/node-server");
    const { Hono } = await import("hono");
    let up = true;
    const server = serve({
      fetch: new Hono().get("/readyz", (c) =>
        c.json({ ready: up }, up ? 200 : 503),
      ).fetch,
      port: 0,
    });
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as { port: number };
    lifecycle.embedderUrl = `http://127.0.0.1:${port}/readyz`;
    try {
      expect(await (await app.request("/readyz")).json()).toMatchObject({
        ready: true,
        model: "external",
      });
      up = false;
      const response = await app.request("/readyz");
      expect(response.status).toBe(503);
      expect((await response.json()).model).toBe("unreachable");
    } finally {
      lifecycle.embedderUrl = undefined;
      server.close();
    }
  });
});

describe("the pool watchdog", () => {
  afterEach(() => vi.useRealTimers());
  const never = () => new Promise<never>(() => {});

  it("fires once after enough probes in a row found no connection", async () => {
    vi.useFakeTimers();
    let fired = 0;
    watchPool({
      onStuck: () => fired++,
      probe: never,
      everyMs: 1_000,
      timeoutMs: 100,
      strikes: 3,
    });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fired).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toBe(1);
  });

  it("counts an answer of any kind as a connection, and starts over on one", async () => {
    vi.useFakeTimers();
    let fired = 0;
    let n = 0;
    const stop = watchPool({
      onStuck: () => fired++,
      probe: () =>
        ++n % 3 === 0 ? Promise.reject(new Error("ECONNREFUSED")) : never(),
      everyMs: 1_000,
      timeoutMs: 100,
      strikes: 3,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toBe(0);
    stop();
  });
});
