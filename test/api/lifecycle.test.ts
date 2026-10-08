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

/** A request from the host itself, which is who the readiness detail is for. */
const onHost = (path: string) =>
  app.request(path, undefined, {
    incoming: { socket: { remoteAddress: "127.0.0.1" } },
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
    const response = await onHost("/readyz");
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
    const body = await (await onHost("/readyz")).json();
    expect(body.schema).toBe("match");
    expect(body.ready).toBe(true);
  });

  it("is not ready when the database was built from another schema.sql", async () => {
    await sql`insert into schema_meta (schema_sha256) values ('0000')`;
    const response = await onHost("/readyz");
    expect(response.status).toBe(503);
    expect((await response.json()).schema).toBe("mismatch");
  });

  it("is not ready while the embedding model loads", async () => {
    lifecycle.modelRequired = true;
    expect((await onHost("/readyz")).status).toBe(503);
    lifecycle.modelReady = true;
    expect((await onHost("/readyz")).status).toBe(200);
  });
});

describe("what the server tells whom", () => {
  it("answers a caller off the host with ready or not, and nothing else", async () => {
    const outside = await app.request("/readyz");
    expect(outside.status).toBe(200);
    expect(await outside.json()).toEqual({ ready: true });

    const lan = await app.request("/readyz", undefined, {
      incoming: { socket: { remoteAddress: "192.168.1.20" } },
    });
    expect(await lan.json()).toEqual({ ready: true });

    const mapped = await app.request("/readyz", undefined, {
      incoming: { socket: { remoteAddress: "::ffff:127.0.0.1" } },
    });
    expect((await mapped.json()).database).toBe(true);
  });

  it("sends the content policy and its companions on every response", async () => {
    for (const path of ["/livez", "/auth/config", "/api/nothing-here"]) {
      const response = await app.request(path);
      const policy = response.headers.get("Content-Security-Policy") ?? "";
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).not.toContain("unsafe-eval");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
    }
  });
});

describe("draining", () => {
  it("fails readiness and refuses new chat turns with a retry hint", async () => {
    lifecycle.draining = true;
    expect((await onHost("/readyz")).status).toBe(503);

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
      expect(await (await onHost("/readyz")).json()).toMatchObject({
        ready: true,
        model: "external",
      });
      up = false;
      const response = await onHost("/readyz");
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
