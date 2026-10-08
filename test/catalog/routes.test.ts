import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addComponent, addLabel } from "@tachy/core/catalog";
import { createUser } from "@tachy/core/access";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

let cookie = "";

/** Send with the admin's cookie; `method` overrides the POST `json()` gives. */
function requestAs(path: string, method: string, body?: unknown) {
  return app.request(path, {
    ...(body === undefined ? {} : json(body)),
    // After the spread: json() sets POST, and every route in this file is
    // something else.
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Cookie: cookie,
    },
  });
}

const get = (path: string) =>
  app.request(path, { headers: { Cookie: cookie } });

beforeEach(async () => {
  await resetData();
  await createUser({
    email: "admin@example.com",
    password: "a-long-password",
    role: "admin",
  });
  cookie = await loginCookie(app, "admin@example.com", "a-long-password");
});

describe("component routes", () => {
  it("creates, lists, patches and deletes a component", async () => {
    const created = await requestAs("/api/products/tpd/components", "POST", {
      slug: "label-renderer",
      name: "Label renderer",
    });
    expect(created.status).toBe(200);

    const listed = await get("/api/products/tpd/components");
    expect(listed.status).toBe(200);
    expect((await listed.json()).map((c: { slug: string }) => c.slug)).toEqual([
      "label-renderer",
    ]);

    const patched = await requestAs(
      "/api/products/tpd/components/label-renderer",
      "PATCH",
      { name: "Renderer" },
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Renderer");

    const deleted = await requestAs(
      "/api/products/tpd/components/label-renderer",
      "DELETE",
    );
    expect(deleted.status).toBe(200);
    expect(await (await get("/api/products/tpd/components")).json()).toEqual(
      [],
    );
  });

  it("refuses a product slug that does not exist", async () => {
    const response = await get("/api/products/no-such-product/components");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no-such-product/);
  });

  // The architecture view draws the whole catalogue, so it needs every
  // component in one answer, each carrying the branch it hangs off.
  it("lists every component with its product and team", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "spooler", name: "Spooler" });
    await addComponent({
      productId,
      slug: "spool-queue",
      name: "Spool queue",
      parentSlug: "spooler",
    });

    const response = await get("/api/components");
    expect(response.status).toBe(200);
    const rows: {
      id: string;
      slug: string;
      parent_id: string | null;
      product_slug: string;
      team_slug: string;
    }[] = await response.json();

    const spooler = rows.find((r) => r.slug === "spooler")!;
    const child = rows.find((r) => r.slug === "spool-queue")!;
    expect(spooler.product_slug).toBe("tpd");
    expect(spooler.team_slug).toBeTruthy();
    expect(spooler.parent_id).toBeNull();
    // parent_id alone carries the nesting; nothing else in the row says it.
    expect(child.parent_id).toBe(spooler.id);
  });

  it("rejects a slug with spaces in it", async () => {
    const response = await requestAs("/api/products/tpd/components", "POST", {
      slug: "Label Renderer",
      name: "Label renderer",
    });
    expect(response.status).toBe(400);
  });

  // The count is what the confirm dialog shows before a rename is agreed to.
  it("counts what a component rename would touch, then renames it", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "spooler", name: "Spooler" });
    await saveKnowledgeEntry({
      productId,
      issueSummary: "Spooler stalls mid-batch",
      component: "spooler",
      // The impact count is over the tag, which is what a rename rewrites.
      tags: ["spooler"],
    });

    const impact = await get(
      "/api/products/tpd/components/spooler/rename-impact",
    );
    expect(impact.status).toBe(200);
    expect((await impact.json()).entries).toBe(1);

    const renamed = await requestAs(
      "/api/products/tpd/components/spooler/rename",
      "POST",
      { to: "print-spooler" },
    );
    expect(renamed.status).toBe(200);

    const listed = await (await get("/api/products/tpd/components")).json();
    expect(listed.map((c: { slug: string }) => c.slug)).toEqual([
      "print-spooler",
    ]);
  });

  // 404 here, unlike an unknown product: the product resolved, the component
  // did not.
  it("404s on rename-impact for a component nobody created", async () => {
    const response = await get(
      "/api/products/tpd/components/nope/rename-impact",
    );
    expect(response.status).toBe(404);
  });
});

describe("label routes", () => {
  it("creates, lists, patches and deletes a label", async () => {
    const created = await requestAs("/api/products/tpd/labels", "POST", {
      slug: "regression",
      description: "Worked before, does not now.",
    });
    expect(created.status).toBe(200);

    const listed = await (await get("/api/products/tpd/labels")).json();
    expect(listed.map((l: { slug: string }) => l.slug)).toEqual(["regression"]);

    const patched = await requestAs(
      "/api/products/tpd/labels/regression",
      "PATCH",
      {
        description: "A behaviour that used to work.",
      },
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).description).toMatch(/used to work/);

    const deleted = await requestAs(
      "/api/products/tpd/labels/regression",
      "DELETE",
    );
    expect(deleted.status).toBe(200);
    expect(await (await get("/api/products/tpd/labels")).json()).toEqual([]);
  });

  it("reports a label rename's impact and carries it out", async () => {
    const productId = await tpdProductId();
    await addLabel(productId, "regression", "Worked before.");

    const impact = await get(
      "/api/products/tpd/labels/regression/rename-impact",
    );
    expect(impact.status).toBe(200);

    const renamed = await requestAs(
      "/api/products/tpd/labels/regression/rename",
      "POST",
      { to: "known-regression" },
    );
    expect(renamed.status).toBe(200);
    const listed = await (await get("/api/products/tpd/labels")).json();
    expect(listed.map((l: { slug: string }) => l.slug)).toEqual([
      "known-regression",
    ]);
  });

  it("rejects a rename to an invalid slug", async () => {
    const productId = await tpdProductId();
    await addLabel(productId, "regression", "Worked before.");
    const response = await requestAs(
      "/api/products/tpd/labels/regression/rename",
      "POST",
      {
        to: "Known Regression",
      },
    );
    expect(response.status).toBe(400);
  });
});

describe("customer routes", () => {
  it("creates, lists, patches and deletes a customer", async () => {
    const created = await requestAs("/api/customers", "POST", {
      name: "Northwind Packaging",
      slug: "northwind",
      emailDomains: ["northwind.invalid"],
    });
    expect(created.status).toBe(200);

    const listed = await (await get("/api/customers")).json();
    expect(listed.map((x: { slug: string }) => x.slug)).toEqual(["northwind"]);

    const patched = await requestAs("/api/customers/northwind", "PATCH", {
      name: "Northwind Ltd",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Northwind Ltd");

    expect((await requestAs("/api/customers/northwind", "DELETE")).status).toBe(
      200,
    );
    expect(await (await get("/api/customers")).json()).toEqual([]);
  });

  it("refuses a customer write from a member", async () => {
    await createUser({
      email: "member@example.com",
      password: "a-long-password",
      role: "member",
    });
    const memberCookie = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );
    const response = await app.request("/api/customers", {
      ...json({ name: "Sneaky", slug: "sneaky" }),
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
    });
    expect(response.status).toBe(403);
  });

  // 400, not 404: the slug is caller-supplied and resolveCustomer treats an
  // unknown one as a bad request - the same message the agent's tools get.
  it("refuses the profile of a customer that does not exist", async () => {
    const response = await get("/api/customers/nope/profile");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/nope/);
  });
});

describe("customer unit and fact routes", () => {
  beforeEach(async () => {
    await requestAs("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });
  });

  it("adds a unit, patches it, lists it and deletes it", async () => {
    const added = await requestAs("/api/customers/northwind/units", "PUT", {
      slug: "line-3",
      name: "Line 3",
      kind: "line",
    });
    expect(added.status).toBe(200);

    const listed = await (await get("/api/customers/northwind/units")).json();
    expect(listed.map((u: { slug: string }) => u.slug)).toEqual(["line-3"]);

    const patched = await requestAs(
      "/api/customers/northwind/units/line-3",
      "PATCH",
      {
        name: "Line three",
      },
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Line three");

    expect(
      (await requestAs("/api/customers/northwind/units/line-3", "DELETE"))
        .status,
    ).toBe(200);
    expect(await (await get("/api/customers/northwind/units")).json()).toEqual(
      [],
    );
  });

  it("records a fact and reads it back on the profile", async () => {
    const put = await requestAs("/api/customers/northwind/facts", "PUT", {
      kind: "version",
      label: "tpd",
      value: "9.2",
    });
    expect(put.status).toBe(200);

    const profile = await (
      await get("/api/customers/northwind/profile")
    ).json();
    expect(JSON.stringify(profile)).toMatch(/9\.2/);

    const facts = await (await get("/api/customers/northwind/facts")).json();
    expect(facts).toHaveLength(1);

    const id = facts[0].id;
    expect(
      (await requestAs(`/api/customers/northwind/facts/${id}`, "DELETE"))
        .status,
    ).toBe(200);
    expect(await (await get("/api/customers/northwind/facts")).json()).toEqual(
      [],
    );
  });

  // The ladder is the point of units: a fact on the line is not visible on the
  // customer as a whole, but the customer's own facts still reach the line.
  it("resolves a unit's facts through the ladder", async () => {
    await requestAs("/api/customers/northwind/units", "PUT", {
      slug: "line-3",
      name: "Line 3",
      kind: "line",
    });
    await requestAs("/api/customers/northwind/facts", "PUT", {
      kind: "contract",
      value: "gold",
    });
    await requestAs("/api/customers/northwind/facts", "PUT", {
      unit: "line-3",
      kind: "version",
      value: "9.2",
    });

    const resolved = await get("/api/customers/northwind/units/line-3/facts");
    expect(resolved.status).toBe(200);
    const body = JSON.stringify(await resolved.json());
    expect(body).toMatch(/gold/);
    expect(body).toMatch(/9\.2/);
  });

  it("lists the fact kinds already in use", async () => {
    await requestAs("/api/customers/northwind/facts", "PUT", {
      kind: "line_layout",
      value: "two lanes",
    });
    const kinds = await (await get("/api/customer-fact-kinds")).json();
    expect(JSON.stringify(kinds)).toMatch(/line_layout/);
  });

  it("rejects a fact with no value", async () => {
    const response = await requestAs("/api/customers/northwind/facts", "PUT", {
      kind: "version",
      value: "",
    });
    expect(response.status).toBe(400);
  });
});

describe("customer component links", () => {
  it("links a component to a customer and unlinks it again", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "spooler", name: "Spooler" });
    await requestAs("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });

    const linked = await requestAs(
      "/api/customers/northwind/components",
      "PUT",
      {
        product_slug: "tpd",
        component: "spooler",
      },
    );
    expect(linked.status).toBe(200);

    const profile = await (
      await get("/api/customers/northwind/profile")
    ).json();
    expect(JSON.stringify(profile)).toMatch(/spooler/);

    const unlinked = await requestAs(
      "/api/customers/northwind/components?product_slug=tpd&component=spooler",
      "DELETE",
    );
    expect(unlinked.status).toBe(200);
  });

  it("says which query parameters an unlink needs", async () => {
    await requestAs("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });
    const response = await requestAs(
      "/api/customers/northwind/components",
      "DELETE",
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/product_slug and component/);
  });
});

describe("overview components", () => {
  it("lays each component's entries over the tree", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "engine", name: "Engine" });
    await addComponent({
      productId,
      slug: "engine-timer",
      name: "Timer",
      parentSlug: "engine",
    });
    await saveKnowledgeEntry({
      status: "approved",
      productId,
      component: "engine-timer",
      issueSummary: "The timer drifts after a DST change",
    });

    const response = await get("/api/overview/components");
    expect(response.status).toBe(200);
    const rows = await response.json();
    const engine = rows.find((r: { slug: string }) => r.slug === "engine");
    expect(
      rows.find((r: { slug: string }) => r.slug === "engine-timer"),
    ).toMatchObject({
      parent_id: engine.id,
      product_slug: "tpd",
      entries: 1,
      searchable: 1,
    });
    expect(engine).toMatchObject({
      parent_id: null,
      entries: 0,
      searchable: 0,
    });
    expect(engine).not.toHaveProperty("description");
  });
});

describe("overview issues", () => {
  it("names what is unfinished in the catalog", async () => {
    const productId = await tpdProductId();
    await addLabel(productId, "undescribed");
    await addLabel(productId, "regression", "Worked before.");

    const response = await get("/api/overview/issues?page=structure");
    expect(response.status).toBe(200);
    const issues = await response.json();
    expect(issues["labels.no_description"]).toEqual({
      n: 1,
      items: [{ key: expect.any(String), label: "undescribed" }],
    });
    for (const issue of Object.values(issues) as {
      n: number;
      items: unknown[];
    }[])
      expect(issue.items.length).toBeLessThanOrEqual(Math.max(issue.n, 0));
  });

  it("names people in no team, and says nothing of app admins when there is one", async () => {
    await createUser({ email: "loner@example.com" });
    const issues = await (await get("/api/overview/issues?page=access")).json();
    expect(issues["users.no_app_admin"]).toEqual({ n: 0, items: [] });
    expect(
      issues["users.no_team"].items.map((i: { label: string }) => i.label),
    ).toContain("loner@example.com");
  });

  it("answers the integrations page with a count and names per issue", async () => {
    const issues = await (
      await get("/api/overview/issues?page=integrations")
    ).json();
    for (const key of [
      "sources.untokened",
      "sources.never_synced",
      "projects.no_wiki",
      "repos.failing",
      "repos.no_component",
    ])
      expect(issues[key]).toMatchObject({
        n: expect.any(Number),
        items: expect.any(Array),
      });
  });

  it("keeps the workers and system pages to app admins", async () => {
    await createUser({
      email: "member@example.com",
      password: "a-long-password",
    });
    const member = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );
    for (const page of ["workers", "system"]) {
      const response = await app.request(`/api/overview/issues?page=${page}`, {
        headers: { Cookie: member },
      });
      expect(response.status).toBe(403);
      expect((await get(`/api/overview/issues?page=${page}`)).status).toBe(200);
    }
    expect((await get("/api/overview/issues?page=nowhere")).status).toBe(400);
  });
});

describe("overview detail routes", () => {
  it("takes a window for the activity figures, within a quarter", async () => {
    const body = await (await get("/api/overview/activity?days=90")).json();
    expect(body.usage.per_day).toHaveLength(90);
    expect(body.tools.days).toBe(90);
    expect(body.traffic.days).toBe(90);

    const dflt = await (await get("/api/overview/activity")).json();
    expect(dflt.usage.days).toBe(30);
    expect(dflt.traffic.days).toBe(14);

    expect((await get("/api/overview/activity?days=3")).status).toBe(400);
    expect((await get("/api/overview/activity?days=400")).status).toBe(400);
  });

  it("says when each source, repo and bucket was last brought up to date", async () => {
    const response = await get("/api/overview/freshness");
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows)
      expect(row).toEqual({
        kind: expect.stringMatching(/^(source|repo|bucket)$/),
        key: expect.any(String),
        label: expect.any(String),
        last_at: expect.toSatisfy(
          (v: unknown) => v === null || typeof v === "string",
        ),
        error: null,
      });
  });

  it("reports what has gone stale in the library", async () => {
    const body = await (await get("/api/overview/stale")).json();
    expect(body.drafts.map((d: { age: string }) => d.age)).toEqual([
      "week",
      "month",
      "quarter",
      "older",
    ]);
    expect(body).toMatchObject({ untouched: 0, unread: 0, doubtful: 0 });
    expect(body.weakest).toEqual([]);
  });
});
