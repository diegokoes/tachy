import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import { json, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const app = createApp();

const post = (path: string, body: unknown) => app.request(path, json(body));
const patch = (path: string, body: unknown) =>
  app.request(path, { ...json(body), method: "PATCH" });
const get = (path: string) => app.request(path);

const category = (scope: string, slug: string, over: object = {}) =>
  post(`/api/library/wiki/${scope}/categories`, { slug, name: slug, ...over });

const article = (scope: string, slug: string, over: object = {}) =>
  post(`/api/library/wiki/${scope}/articles`, {
    slug,
    title: slug,
    body: "body",
    ...over,
  });

describe("wiki API", () => {
  beforeEach(resetData);

  it("serves a product's table of contents with nested categories", async () => {
    await category("tpd", "trouble", { name: "Troubleshooting" });
    await category("tpd", "printing", {
      name: "Printing",
      parentSlug: "trouble",
    });
    await article("tpd", "spooler-stalls", { categories: ["printing"] });

    const toc = await (await get("/api/library/wiki/tpd/toc")).json();
    expect(toc.categories).toHaveLength(1);
    expect(toc.categories[0].slug).toBe("trouble");
    expect(toc.categories[0].children[0].slug).toBe("printing");
    expect(toc.categories[0].children[0].articles[0].slug).toBe(
      "spooler-stalls",
    );
    expect(toc.uncategorised).toEqual([]);
  });

  it("files one article under several categories", async () => {
    await category("tpd", "printing");
    await category("tpd", "hardware");
    await article("tpd", "spooler", { categories: ["printing", "hardware"] });

    const toc = await (await get("/api/library/wiki/tpd/toc")).json();
    const slugs = toc.categories.map((c: any) => c.slug).sort();
    expect(slugs).toEqual(["hardware", "printing"]);
    for (const c of toc.categories)
      expect(c.articles.map((a: any) => a.slug)).toEqual(["spooler"]);
  });

  it("serves an article by slug with its categories", async () => {
    await category("tpd", "printing");
    await article("tpd", "spooler", {
      categories: ["printing"],
      title: "Spooler",
    });

    const doc = await (
      await get("/api/library/wiki/tpd/articles/spooler")
    ).json();
    expect(doc.title).toBe("Spooler");
    expect(doc.kind).toBe("wiki");
    expect(doc.categories.map((c: any) => c.slug)).toEqual(["printing"]);
  });

  it("edits an article in place, keeping its id and its categories", async () => {
    await category("tpd", "printing");
    const created = await (
      await article("tpd", "spooler", { categories: ["printing"] })
    ).json();

    const res = await patch("/api/library/wiki/tpd/articles/spooler", {
      body: "rewritten",
    });
    expect(res.status).toBe(200);

    const doc = await (
      await get("/api/library/wiki/tpd/articles/spooler")
    ).json();
    expect(doc.id).toBe(created.id);
    expect(doc.body).toBe("rewritten");
    expect(doc.categories.map((c: any) => c.slug)).toEqual(["printing"]);
  });

  it("reports no main page for a new wiki instead of 404ing", async () => {
    const res = await get("/api/library/wiki/tpd/main");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();

    await article("tpd", "main", { title: "TPD Wiki" });
    expect((await (await get("/api/library/wiki/tpd/main")).json()).title).toBe(
      "TPD Wiki",
    );
  });

  it("keeps the org-wide wiki separate from a product's", async () => {
    await article("tpd", "shared", { title: "Product one" });
    await article("general", "shared", { title: "Org wide" });

    expect(
      (await (await get("/api/library/wiki/tpd/articles/shared")).json()).title,
    ).toBe("Product one");
    expect(
      (await (await get("/api/library/wiki/general/articles/shared")).json())
        .title,
    ).toBe("Org wide");
  });

  it("404s an unknown wiki scope", async () => {
    expect((await get("/api/library/wiki/nope/toc")).status).toBe(404);
  });

  it("rejects a reserved article slug", async () => {
    const res = await article("tpd", "toc");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved/);
  });

  it("refuses a category re-parent that would cycle", async () => {
    await category("tpd", "a");
    await category("tpd", "b", { parentSlug: "a" });
    const res = await patch("/api/library/wiki/tpd/categories/a", {
      parentSlug: "b",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cycle/);
  });

  it("counts a read of an article", async () => {
    const created = await (await article("tpd", "spooler")).json();
    await get("/api/library/wiki/tpd/articles/spooler");
    await new Promise((r) => setTimeout(r, 50));
    const views = await (
      await get(`/api/reference/${created.id}/views`)
    ).json();
    expect(views.views).toBe(1);
  });

  it("keeps articles out of the docs shelf but in search", async () => {
    await article("tpd", "spooler", {
      title: "Spooler subsystem",
      body: "the spooler stalls when the queue overruns",
    });
    const docs = await (await get("/api/reference")).json();
    expect(docs).toEqual([]);

    const hits = await (
      await get(
        "/api/reference/search?q=" + encodeURIComponent("spooler stalls"),
      )
    ).json();
    expect(hits.map((h: any) => h.title)).toContain("Spooler subsystem");
  });
});

describe("wiki coverage API", () => {
  beforeEach(resetData);

  it("serves the component tree with counts and the unfiled bucket", async () => {
    const res = await get("/api/library/wiki/tpd/coverage");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("nodes");
    expect(body.unfiled).toMatchObject({ entries: 0, docs: 0, articles: 0 });
  });

  it("refuses coverage for the org-wide wiki, which has no components", async () => {
    const res = await get("/api/library/wiki/general/coverage");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/per product/);
  });

  it("rejects 'coverage' as an article slug", async () => {
    const res = await article("tpd", "coverage");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved/);
  });
});
