import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  addSourceProject,
  createUser,
  linkRepo,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

/**
 * Reindexing clones the repo, so the route's own contract is what is tested
 * here: who may call it, and what it does with a slug that is not there. The
 * clone-and-index path itself is code-index.test.ts, against a real git repo in
 * a temp dir.
 */
async function adminCookie(): Promise<string> {
  await createUser({
    email: "repo-admin@example.com",
    password: "a-long-password",
    role: "admin",
  });
  return loginCookie(app, "repo-admin@example.com", "a-long-password");
}

beforeEach(resetData);

describe("GET /api/repos", () => {
  it("lists what is linked, and filters by product", async () => {
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
      productSlug: "tpd",
    });
    await linkRepo({
      slug: "tracer",
      url: "https://example.invalid/tracer.git",
      productSlug: "ftrace",
    });

    const all = await app.request("/api/repos");
    expect(all.status).toBe(200);
    expect((await all.json()).repos).toHaveLength(2);

    const scoped = await app.request("/api/repos?product_slug=tpd");
    const { repos } = await scoped.json();
    expect(repos.map((r: { slug: string }) => r.slug)).toEqual(["driver"]);
  });

  /**
   * A customer filter keeps the unscoped repos: the product's own code is what
   * most of their questions are about, and dropping it would leave the customer
   * view holding only their fork.
   */
  it("narrows to one customer without hiding the shared repos", async () => {
    await addCustomer({ name: "Northwind", slug: "northwind" });
    await addCustomer({ name: "Baltic", slug: "baltic" });
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
      productSlug: "tpd",
      customerSlug: "northwind",
    });
    await linkRepo({
      slug: "fork",
      url: "https://example.invalid/fork.git",
      productSlug: "tpd",
      customerSlug: "baltic",
    });
    await linkRepo({
      slug: "tracer",
      url: "https://example.invalid/tracer.git",
      productSlug: "tpd",
    });

    const res = await app.request("/api/repos?customer=northwind");
    const { repos } = await res.json();
    expect(repos.map((r: { slug: string }) => r.slug)).toEqual([
      "driver",
      "tracer",
    ]);
  });

  it("returns an empty list rather than 404 when nothing is linked", async () => {
    const res = await app.request("/api/repos");
    expect(res.status).toBe(200);
    expect((await res.json()).repos).toEqual([]);
  });
});

describe("PUT /api/repos", () => {
  it("links a repo for an admin", async () => {
    const cookie = await adminCookie();
    const res = await app.request("/api/repos", {
      ...json({
        slug: "driver",
        url: "https://example.invalid/driver.git",
        product: "tpd",
      }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).repo.slug).toBe("driver");
  });

  it("rejects a slug the indexer could not name a directory after", async () => {
    const cookie = await adminCookie();
    const res = await app.request("/api/repos", {
      ...json({
        slug: "Driver Repo",
        url: "https://example.invalid/driver.git",
        product: "tpd",
      }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a body with no url", async () => {
    const cookie = await adminCookie();
    const res = await app.request("/api/repos", {
      ...json({ slug: "driver", product: "tpd" }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/repos/bulk", () => {
  /** An Azure DevOps project routinely holds fifty; one bad row must not sink the rest. */
  it("links every good row and reports the bad one", async () => {
    const cookie = await adminCookie();
    const project = await addSourceProject({
      sourceSlug: "test-freshdesk",
      externalKey: "bulk-proj",
      role: "knowledge",
      productSlug: "tpd",
    });

    const res = await app.request("/api/repos/bulk", {
      ...json({
        source_project_id: project.id,
        repos: [
          { slug: "driver", url: "https://example.invalid/driver.git" },
          { slug: "NOT A SLUG", url: "https://example.invalid/bad.git" },
          { slug: "renderer", url: "https://example.invalid/renderer.git" },
        ],
      }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.linked).toBe(2);
    expect(
      body.results.find((r: { slug: string }) => r.slug === "NOT A SLUG"),
    ).toMatchObject({ ok: false });

    const listed = await (
      await app.request("/api/repos", { headers: { Cookie: cookie } })
    ).json();
    expect(listed.repos.map((r: { slug: string }) => r.slug).sort()).toEqual([
      "driver",
      "renderer",
    ]);
  });

  it("rejects an empty repo list", async () => {
    const cookie = await adminCookie();
    const project = await addSourceProject({
      sourceSlug: "test-freshdesk",
      externalKey: "bulk-empty",
      role: "knowledge",
      productSlug: "tpd",
    });
    const res = await app.request("/api/repos/bulk", {
      ...json({ source_project_id: project.id, repos: [] }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/repos/:slug/reindex", () => {
  it("refuses a slug nobody has linked, without cloning anything", async () => {
    const cookie = await adminCookie();
    const res = await app.request("/api/repos/no-such-repo/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("refuses a caller who is not an admin", async () => {
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
    });
    await createUser({
      email: "member@example.com",
      password: "a-long-password",
      role: "member",
    });
    // A second, admin user: enforcement is only on once an admin exists.
    await adminCookie();
    const cookie = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );

    const res = await app.request("/api/repos/driver/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/repos/:slug", () => {
  it("unlinks a repo and takes its files with it", async () => {
    const cookie = await adminCookie();
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
      productSlug: "tpd",
    });
    const res = await app.request("/api/repos/driver", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const left = await (
      await app.request("/api/repos", { headers: { Cookie: cookie } })
    ).json();
    expect(left.repos).toEqual([]);
    expect(await tpdProductId()).toBeTruthy();
  });
});
