import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addLabel,
  createUser,
  saveKnowledgeEntry,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

let cookie = "";

/** Send with the admin's cookie; `method` overrides the POST `json()` gives. */
function as(path: string, method: string, body?: unknown) {
  return app.request(path, {
    ...(body === undefined ? {} : json(body)),
    // After the spread: json() sets POST, and every route below is something else.
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
    const created = await as("/api/products/tpd/components", "POST", {
      slug: "label-renderer",
      name: "Label renderer",
    });
    expect(created.status).toBe(200);

    const listed = await get("/api/products/tpd/components");
    expect(listed.status).toBe(200);
    expect((await listed.json()).map((c: { slug: string }) => c.slug)).toEqual([
      "label-renderer",
    ]);

    const patched = await as(
      "/api/products/tpd/components/label-renderer",
      "PATCH",
      { name: "Renderer" },
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Renderer");

    const deleted = await as(
      "/api/products/tpd/components/label-renderer",
      "DELETE",
    );
    expect(deleted.status).toBe(200);
    expect(await (await get("/api/products/tpd/components")).json()).toEqual(
      [],
    );
  });

  it("refuses a product slug that does not exist", async () => {
    const res = await get("/api/products/no-such-product/components");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no-such-product/);
  });

  it("rejects a slug with spaces in it", async () => {
    const res = await as("/api/products/tpd/components", "POST", {
      slug: "Label Renderer",
      name: "Label renderer",
    });
    expect(res.status).toBe(400);
  });

  /** The count is what the confirm dialog shows before a rename is agreed to. */
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

    const renamed = await as(
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

  /** 404 here, unlike the product above: the product resolved, the component did not. */
  it("404s on rename-impact for a component nobody created", async () => {
    const res = await get("/api/products/tpd/components/nope/rename-impact");
    expect(res.status).toBe(404);
  });
});

describe("label routes", () => {
  it("creates, lists, patches and deletes a label", async () => {
    const created = await as("/api/products/tpd/labels", "POST", {
      slug: "regression",
      description: "Worked before, does not now.",
    });
    expect(created.status).toBe(200);

    const listed = await (await get("/api/products/tpd/labels")).json();
    expect(listed.map((l: { slug: string }) => l.slug)).toEqual(["regression"]);

    const patched = await as("/api/products/tpd/labels/regression", "PATCH", {
      description: "A behaviour that used to work.",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).description).toMatch(/used to work/);

    const deleted = await as("/api/products/tpd/labels/regression", "DELETE");
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

    const renamed = await as(
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
    const res = await as("/api/products/tpd/labels/regression/rename", "POST", {
      to: "Known Regression",
    });
    expect(res.status).toBe(400);
  });
});

describe("customer routes", () => {
  it("creates, lists, patches and deletes a customer", async () => {
    const created = await as("/api/customers", "POST", {
      name: "Northwind Packaging",
      slug: "northwind",
      emailDomains: ["northwind.invalid"],
    });
    expect(created.status).toBe(200);

    const listed = await (await get("/api/customers")).json();
    expect(listed.map((x: { slug: string }) => x.slug)).toEqual(["northwind"]);

    const patched = await as("/api/customers/northwind", "PATCH", {
      name: "Northwind Ltd",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Northwind Ltd");

    expect((await as("/api/customers/northwind", "DELETE")).status).toBe(200);
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
    const res = await app.request("/api/customers", {
      ...json({ name: "Sneaky", slug: "sneaky" }),
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
    });
    expect(res.status).toBe(403);
  });

  /**
   * 400, not 404: the slug is caller-supplied and resolveCustomer treats an
   * unknown one as a bad request — the same message the agent's tools get.
   */
  it("refuses the profile of a customer that does not exist", async () => {
    const res = await get("/api/customers/nope/profile");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nope/);
  });
});

describe("customer unit and fact routes", () => {
  beforeEach(async () => {
    await as("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });
  });

  it("adds a unit, patches it, lists it and deletes it", async () => {
    const added = await as("/api/customers/northwind/units", "PUT", {
      slug: "line-3",
      name: "Line 3",
      kind: "line",
    });
    expect(added.status).toBe(200);

    const listed = await (await get("/api/customers/northwind/units")).json();
    expect(listed.map((u: { slug: string }) => u.slug)).toEqual(["line-3"]);

    const patched = await as("/api/customers/northwind/units/line-3", "PATCH", {
      name: "Line three",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).name).toBe("Line three");

    expect(
      (await as("/api/customers/northwind/units/line-3", "DELETE")).status,
    ).toBe(200);
    expect(await (await get("/api/customers/northwind/units")).json()).toEqual(
      [],
    );
  });

  it("records a fact and reads it back on the profile", async () => {
    const put = await as("/api/customers/northwind/facts", "PUT", {
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
      (await as(`/api/customers/northwind/facts/${id}`, "DELETE")).status,
    ).toBe(200);
    expect(await (await get("/api/customers/northwind/facts")).json()).toEqual(
      [],
    );
  });

  /**
   * The ladder is the point of units: a fact on the line is not visible on the
   * customer as a whole, but the customer's own facts still reach the line.
   */
  it("resolves a unit's facts through the ladder", async () => {
    await as("/api/customers/northwind/units", "PUT", {
      slug: "line-3",
      name: "Line 3",
      kind: "line",
    });
    await as("/api/customers/northwind/facts", "PUT", {
      kind: "contract",
      value: "gold",
    });
    await as("/api/customers/northwind/facts", "PUT", {
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
    await as("/api/customers/northwind/facts", "PUT", {
      kind: "line_layout",
      value: "two lanes",
    });
    const kinds = await (await get("/api/customer-fact-kinds")).json();
    expect(JSON.stringify(kinds)).toMatch(/line_layout/);
  });

  it("rejects a fact with no value", async () => {
    const res = await as("/api/customers/northwind/facts", "PUT", {
      kind: "version",
      value: "",
    });
    expect(res.status).toBe(400);
  });
});

describe("customer component links", () => {
  it("links a component to a customer and unlinks it again", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "spooler", name: "Spooler" });
    await as("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });

    const linked = await as("/api/customers/northwind/components", "PUT", {
      product_slug: "tpd",
      component: "spooler",
    });
    expect(linked.status).toBe(200);

    const profile = await (
      await get("/api/customers/northwind/profile")
    ).json();
    expect(JSON.stringify(profile)).toMatch(/spooler/);

    const unlinked = await as(
      "/api/customers/northwind/components?product_slug=tpd&component=spooler",
      "DELETE",
    );
    expect(unlinked.status).toBe(200);
  });

  it("says which query parameters an unlink needs", async () => {
    await as("/api/customers", "POST", {
      name: "Northwind",
      slug: "northwind",
    });
    const res = await as("/api/customers/northwind/components", "DELETE");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/product_slug and component/);
  });
});
