import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "../packages/api/src/app";
import { lifecycle } from "../packages/api/src/lifecycle";
import { json, sql } from "./helpers";

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
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
  });

  it("is ready on a database that predates the schema stamp", async () => {
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
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
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect((await res.json()).schema).toBe("mismatch");
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

    const res = await app.request(
      "/api/agent/chat",
      json({ message: "hello" }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
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
      const res = await app.request("/readyz");
      expect(res.status).toBe(503);
      expect((await res.json()).model).toBe("unreachable");
    } finally {
      lifecycle.embedderUrl = undefined;
      server.close();
    }
  });
});
