/**
 * Reindexing clones the repo, so the route's own contract is what is tested
 * here: who may call it, and what it does with a slug that is not there. The
 * clone-and-index path itself is code-index.test.ts, against a real git repo in
 * a temp dir.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addCustomer } from "@tachy/core/catalog";
import { addSourceProject } from "@tachy/core/sources";
import { createUser } from "@tachy/core/access";
import { linkRepo } from "@tachy/core/code";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql, tpdProductId, resetJobs } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

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

  // A customer filter keeps the unscoped repos: the product's own code is what
  // most of their questions are about, and dropping it would leave the customer
  // view holding only their fork.
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

    const response = await app.request("/api/repos?customer=northwind");
    const { repos } = await response.json();
    expect(repos.map((r: { slug: string }) => r.slug)).toEqual([
      "driver",
      "tracer",
    ]);
  });

  it("returns an empty list rather than 404 when nothing is linked", async () => {
    const response = await app.request("/api/repos");
    expect(response.status).toBe(200);
    expect((await response.json()).repos).toEqual([]);
  });
});

describe("PUT /api/repos", () => {
  it("links a repo for an admin", async () => {
    const cookie = await adminCookie();
    const response = await app.request("/api/repos", {
      ...json({
        slug: "driver",
        url: "https://example.invalid/driver.git",
        product: "tpd",
      }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).repo.slug).toBe("driver");
  });

  it("rejects a slug the indexer could not name a directory after", async () => {
    const cookie = await adminCookie();
    const response = await app.request("/api/repos", {
      ...json({
        slug: "Driver Repo",
        url: "https://example.invalid/driver.git",
        product: "tpd",
      }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a body with no url", async () => {
    const cookie = await adminCookie();
    const response = await app.request("/api/repos", {
      ...json({ slug: "driver", product: "tpd" }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(response.status).toBe(400);
  });
});

describe("PUT /api/repos/bulk", () => {
  // An Azure DevOps project routinely holds fifty; one bad row must not sink
  // the rest.
  it("links every good row and reports the bad one", async () => {
    const cookie = await adminCookie();
    const project = await addSourceProject({
      sourceSlug: "test-freshdesk",
      externalKey: "bulk-proj",
      productSlug: "tpd",
    });

    const response = await app.request("/api/repos/bulk", {
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
    expect(response.status).toBe(200);
    const body = await response.json();
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
      productSlug: "tpd",
    });
    const response = await app.request("/api/repos/bulk", {
      ...json({ source_project_id: project.id, repos: [] }),
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(response.status).toBe(400);
  });
});

describe("POST /api/repos/:slug/reindex", () => {
  it("queues a reindex run for the caller, and hands back that run while it waits", async () => {
    await resetJobs();
    const cookie = await adminCookie();
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
    });
    const response = await app.request("/api/repos/driver/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(202);
    const { run_id } = await response.json();
    const [run] =
      await sql`select kind, params, trigger, requested_by, resource_class, queue, priority from job_runs where id = ${run_id}`;
    expect(run).toMatchObject({
      kind: "repo.reindex",
      params: { repo: "driver" },
      trigger: "manual",
      resource_class: "heavy",
      queue: "index",
      priority: 10,
    });
    expect(run.requested_by).not.toBeNull();

    const again = await app.request("/api/repos/driver/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ status: "in_flight", run_id });
    expect(await sql`select 1 from job_runs`).toHaveLength(1);
  });

  it("queues one line, and refuses a line the repo does not track", async () => {
    await resetJobs();
    const cookie = await adminCookie();
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
      defaultBranch: "master",
      lines: ["legacy/master-1-50"],
    });
    const untracked = await app.request("/api/repos/driver/reindex", {
      ...json({ line: "legacy/master-1-49" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(untracked.status).toBe(400);

    const response = await app.request("/api/repos/driver/reindex", {
      ...json({ line: "legacy/master-1-50" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    expect(response.status).toBe(202);
    const [run] = await sql`
      select params from job_runs where id = ${(await response.json()).run_id}
    `;
    expect(run.params).toEqual({ repo: "driver", line: "legacy/master-1-50" });
  });

  it("shows each repo's reindex while it waits", async () => {
    await resetJobs();
    const cookie = await adminCookie();
    await linkRepo({
      slug: "driver",
      url: "https://example.invalid/driver.git",
    });
    await linkRepo({ slug: "idle", url: "https://example.invalid/idle.git" });
    const { run_id } = await (
      await app.request("/api/repos/driver/reindex", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    ).json();
    const { repos } = await (
      await app.request("/api/repos", { headers: { Cookie: cookie } })
    ).json();
    const bySlug = Object.fromEntries(repos.map((r: any) => [r.slug, r]));
    expect(bySlug.driver.active_run).toMatchObject({
      id: run_id,
      status: "queued",
      line: null,
    });
    expect(bySlug.idle.active_run).toBeNull();
  });

  it("queues every linked repo under one parent run, for admins only", async () => {
    await resetJobs();
    const cookie = await adminCookie();
    const response = await app.request("/api/repos/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(202);
    const { run_id, status } = await response.json();
    expect(status).toBe("queued");
    const [run] =
      await sql`select kind, params, trigger, priority from job_runs where id = ${run_id}`;
    expect(run).toEqual({
      kind: "repos.refresh",
      params: { scope: "all" },
      trigger: "manual",
      priority: 10,
    });
    const again = await (
      await app.request("/api/repos/reindex", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    ).json();
    expect(again).toMatchObject({ status: "in_flight", run_id });

    await createUser({
      email: "member@example.com",
      password: "a-long-password",
      role: "member",
    });
    const member = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );
    expect(
      (
        await app.request("/api/repos/reindex", {
          method: "POST",
          headers: { Cookie: member },
        })
      ).status,
    ).toBe(403);
  });

  it("refuses a slug nobody has linked, without cloning anything", async () => {
    const cookie = await adminCookie();
    const response = await app.request("/api/repos/no-such-repo/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
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

    const response = await app.request("/api/repos/driver/reindex", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(403);
  });
});

describe("PUT /api/repos lines", () => {
  it("tracks the lines it is given, and keeps them when it is given none", async () => {
    const cookie = await adminCookie();
    const put = (body: Record<string, unknown>) =>
      app.request("/api/repos", {
        ...json({
          slug: "driver",
          url: "https://example.invalid/driver.git",
          ...body,
        }),
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
      });
    expect(
      (await put({ branch: "master", lines: ["legacy/master-1-50"] })).status,
    ).toBe(200);
    const lines = async () =>
      (
        await (
          await app.request("/api/repos", { headers: { Cookie: cookie } })
        ).json()
      ).repos[0].lines.map((l: { ref: string }) => l.ref);
    expect(await lines()).toEqual(["master", "legacy/master-1-50"]);

    await put({ branch: "master" });
    expect(await lines()).toEqual(["master", "legacy/master-1-50"]);

    await put({ branch: "main", lines: [] });
    expect(await lines()).toEqual(["main"]);
  });
});

describe("GET /api/repos/refs", () => {
  it("is for whoever may link there, like the link itself", async () => {
    await createUser({
      email: "member@example.com",
      password: "a-long-password",
      role: "member",
    });
    await adminCookie();
    const cookie = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );
    const response = await app.request(
      "/api/repos/refs?url=https://example.invalid/r.git",
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(403);
  });

  it("reports a remote it cannot read instead of failing the request", async () => {
    const cookie = await adminCookie();
    const response = await app.request(
      "/api/repos/refs?url=file:///nonexistent/tachy-repo",
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });
});

describe("GET /api/repos/file-icons/:file", () => {
  it("serves a theme icon as an SVG", async () => {
    const response = await app.request("/api/repos/file-icons/typescript.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  it("refuses an id the theme does not define", async () => {
    for (const file of ["nope.svg", "typescript", "..%2F..%2Fpackage.json"])
      expect((await app.request(`/api/repos/file-icons/${file}`)).status).toBe(
        404,
      );
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
    const response = await app.request("/api/repos/driver", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const left = await (
      await app.request("/api/repos", { headers: { Cookie: cookie } })
    ).json();
    expect(left.repos).toEqual([]);
    expect(await tpdProductId()).toBeTruthy();
  });
});
