import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp();
const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

describe("API health", () => {
  it("reports ok when the DB is reachable", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("API knowledge round-trip", () => {
  beforeEach(resetData);

  it("creates an entry, fetches it, and finds it via search", async () => {
    const created = await app.request(
      "/api/knowledge",
      json({
        status: "approved",
        issueSummary: "Printer queue stalls after reboot",
        symptoms: ["queue stalled"],
        cloud: "prod",
        learningValue: "high",
      }),
    );
    expect(created.status).toBe(200);
    const { id } = await created.json();
    expect(id).toBeTruthy();

    const got = await app.request(`/api/knowledge/${id}`);
    expect(got.status).toBe(200);
    expect((await got.json()).issue_summary).toMatch(/Printer queue/);

    const search = await app.request(
      "/api/knowledge/search?q=printer%20queue%20stalls&cloud=prod",
    );
    const rows = await search.json();
    expect(rows.some((r: { id: string }) => r.id === id)).toBe(true);
  });

  it("records and lists feedback", async () => {
    const created = await app.request(
      "/api/knowledge",
      json({ status: "approved", issueSummary: "x" }),
    );
    const { id } = await created.json();

    const fb = await app.request(
      `/api/knowledge/${id}/feedback`,
      json({ kind: "rating", rating: 5, comment: "useful" }),
    );
    expect(fb.status).toBe(200);

    const list = await app.request(`/api/knowledge/${id}/feedback`);
    expect((await list.json()).length).toBe(1);
  });
});

describe("API taxonomy", () => {
  beforeEach(resetData);

  it("adds and lists a resolution pattern", async () => {
    const added = await app.request(
      "/api/resolution-patterns",
      json({ slug: "rollback", description: "roll back a release" }),
    );
    expect(added.status).toBe(200);
    const list = await app.request("/api/resolution-patterns");
    expect(
      (await list.json()).some((p: { slug: string }) => p.slug === "rollback"),
    ).toBe(true);
  });
});

describe("API error paths", () => {
  beforeEach(resetData);

  it("rejects a schema violation with 400", async () => {
    const res = await app.request(
      "/api/knowledge",
      json({ issueSummary: "x", cloud: "Not A Slug" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await app.request("/api/knowledge", {
      method: "POST",
      body: "{ not json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown knowledge id", async () => {
    const res = await app.request(
      "/api/knowledge/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for an unknown referenced slug (bad_input)", async () => {
    const res = await app.request(
      "/api/products",
      json({ team_slug: "nope-team", slug: "p", name: "P" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale optimistic-lock version", async () => {
    const created = await app.request(
      "/api/knowledge",
      json({ status: "approved", issueSummary: "v" }),
    );
    const { id } = await created.json();
    const res = await app.request(`/api/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ issueSummary: "changed", expectedVersion: 99 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
  });
});

describe("API reference docs", () => {
  beforeEach(resetData);

  it("lists reference docs (empty on a fresh db)", async () => {
    const res = await app.request("/api/reference");
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe("API auth", () => {
  const secured = createApp({ apiToken: "s3cret" });

  it("leaves /health open but requires the token elsewhere", async () => {
    expect((await secured.request("/health")).status).toBe(200);
    expect((await secured.request("/api/customers")).status).toBe(401);
    const ok = await secured.request("/api/customers", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a wrong token", async () => {
    const res = await secured.request("/api/customers", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("does not expose SSO routes when OIDC is unconfigured", async () => {
    expect((await app.request("/auth/login")).status).toBe(404);
    const me = await app.request("/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: "admin", via: "open" });
  });
});

describe("SPA hosting", () => {
  it("serves index.html as a fallback for non-API routes when webRoot is set", async () => {
    const withWeb = createApp({ webRoot: "test/fixtures-web" });
    const res = await withWeb.request("/some/client/route");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("tachy-spa-fixture");
  });
});
