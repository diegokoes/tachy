import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  clearPermissionCache,
  createUser,
  MAX_ASSET_BYTES,
  saveKnowledgeEntry,
} from "@tachy/core";
import { createApp } from "../packages/api/src/app";
import { json, loginCookie, resetData, sql, tpdProductId } from "./helpers";

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

  it("renames an article, rewriting links to it and keeping the old address", async () => {
    const created = await (await article("tpd", "vpn-setup")).json();
    await article("tpd", "remote-work", {
      body: "See [[vpn-setup]] and [[vpn-setup|the VPN page]].",
    });

    const res = await patch("/api/library/wiki/tpd/articles/vpn-setup", {
      slug: "vpn-configuration",
    });
    expect(res.status).toBe(200);

    const linker = await (
      await get("/api/library/wiki/tpd/articles/remote-work")
    ).json();
    expect(linker.body).toBe(
      "See [[vpn-configuration]] and [[vpn-configuration|the VPN page]].",
    );

    const old = await (
      await get("/api/library/wiki/tpd/articles/vpn-setup")
    ).json();
    expect(old.id).toBe(created.id);
    expect(old.slug).toBe("vpn-configuration");
  });

  it("gives an old address to a new article that takes it", async () => {
    await article("tpd", "vpn-setup");
    await patch("/api/library/wiki/tpd/articles/vpn-setup", {
      slug: "vpn-configuration",
    });
    const fresh = await (
      await article("tpd", "vpn-setup", { title: "Fresh" })
    ).json();

    const doc = await (
      await get("/api/library/wiki/tpd/articles/vpn-setup")
    ).json();
    expect(doc.id).toBe(fresh.id);
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

  /** What the contents page sends to move a category: `parentSlug`, not `parent`. */
  it("moves a category under another", async () => {
    await category("tpd", "trouble");
    await category("tpd", "printing");
    const res = await patch("/api/library/wiki/tpd/categories/printing", {
      parentSlug: "trouble",
    });
    expect(res.status).toBe(200);
    const toc = await (await get("/api/library/wiki/tpd/toc")).json();
    expect(toc.categories.map((c: any) => c.slug)).toEqual(["trouble"]);
    expect(toc.categories[0].children[0].slug).toBe("printing");
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

describe("wiki sections & search API", () => {
  beforeEach(resetData);

  it("round-trips a section's lead article and covered components", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "portal", name: "Portal" });
    await addComponent({ productId, slug: "hub", name: "HUB" });
    await article("tpd", "portal-home", { title: "Portal home" });
    const res = await category("tpd", "portal", {
      name: "Portal",
      leadSlug: "portal-home",
      componentSlugs: ["portal", "hub"],
    });
    expect(res.status).toBe(200);

    const toc = await (await get("/api/library/wiki/tpd/toc")).json();
    const sec = toc.categories.find((c: any) => c.slug === "portal");
    expect(sec.lead_slug).toBe("portal-home");
    expect(sec.components.map((c: any) => c.slug).sort()).toEqual([
      "hub",
      "portal",
    ]);
  });

  it("seeds sections from the product's top-level components", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "portal", name: "Portal" });
    await addComponent({ productId, slug: "backend", name: "Backend" });
    const res = await post("/api/library/wiki/tpd/sections/seed", {});
    expect(res.status).toBe(200);
    expect((await res.json()).created).toHaveLength(2);
    const toc = await (await get("/api/library/wiki/tpd/toc")).json();
    expect(toc.categories.map((c: any) => c.slug).sort()).toEqual([
      "backend",
      "portal",
    ]);
  });

  it("refuses to seed the org-wide wiki, which has no components", async () => {
    const res = await post("/api/library/wiki/general/sections/seed", {});
    expect(res.status).toBe(400);
  });

  it("searches this wiki's articles, drafts included", async () => {
    await article("tpd", "spooler-stalls", {
      title: "Spooler stalls",
      body: "the print spooler stops",
      status: "draft",
    });
    const res = await get("/api/library/wiki/tpd/search?q=spooler");
    expect(res.status).toBe(200);
    const hits = await res.json();
    expect(hits.map((h: any) => h.slug)).toEqual(["spooler-stalls"]);
  });
});

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const form = (bytes: Uint8Array, name: string, type: string) => {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type }));
  return fd;
};

const upload = (
  bytes: Uint8Array,
  name = "shot.png",
  type = "image/png",
  scope = "tpd",
) =>
  app.request(`/api/library/wiki/${scope}/assets`, {
    method: "POST",
    body: form(bytes, name, type),
  });

describe("wiki images API", () => {
  beforeEach(resetData);

  it("stores an image and serves it back as nothing but a picture", async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.url).toBe(`/api/library/assets/${saved.id}`);
    expect(saved.content_type).toBe("image/png");

    const got = await app.request(saved.url);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PNG);
  });

  it("stores the same picture once, however often it is pasted", async () => {
    const a = await (await upload(PNG, "one.png")).json();
    const b = await (await upload(PNG, "two.png")).json();
    expect(b.id).toBe(a.id);
  });

  /** The type comes from the bytes: an SVG can carry script, and a page of
      HTML named .png is still a page of HTML. */
  it("reads the bytes, not the label on them", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await upload(svg, "x.svg", "image/svg+xml")).status).toBe(400);

    const res = await upload(Buffer.from("<html><script>x</script></html>"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PNG, JPEG, GIF or WebP/);
  });

  it("refuses an image over the limit", async () => {
    const big = new Uint8Array(MAX_ASSET_BYTES + 1);
    big.set(PNG);
    const res = await upload(big);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
  });

  it("404s an image that does not exist", async () => {
    expect((await get("/api/library/assets/not-a-uuid")).status).toBe(404);
    expect(
      (await get("/api/library/assets/00000000-0000-4000-8000-000000000000"))
        .status,
    ).toBe(404);
  });

  it("refuses an upload from someone who cannot edit that wiki", async () => {
    clearPermissionCache();
    await createUser({
      email: "outsider@example.com",
      password: "outsider-password",
      role: "member",
    });
    const authed = createApp({ passwordAuth: true });
    const cookie = await loginCookie(
      authed,
      "outsider@example.com",
      "outsider-password",
    );
    const res = await authed.request("/api/library/wiki/tpd/assets", {
      method: "POST",
      body: form(PNG, "a.png", "image/png"),
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("wiki gaps API", () => {
  beforeEach(resetData);

  /** A write through the wiki routes rescans its own wiki before answering. */
  it("has found a gap by the time the write that made it returns", async () => {
    await article("tpd", "a", { body: "see [[missing-page]]" });
    const body = await (await get("/api/library/wiki/tpd/gaps")).json();
    expect(body.gaps.map((g: any) => [g.kind, g.key])).toContainEqual([
      "wanted",
      "missing-page",
    ]);
    expect(body.coverage).toHaveProperty("nodes");
  });

  it("serves the org-wide wiki's gaps with no coverage tree", async () => {
    await article("general", "loose");
    const body = await (await get("/api/library/wiki/general/gaps")).json();
    expect(body.coverage).toBeNull();
    expect(body.gaps.map((g: any) => g.kind)).toEqual(["uncategorised"]);
  });

  it("rescans on request, and a dismissal takes it off the list", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "coding", name: "Coding" });
    for (const n of [1, 2, 3])
      await saveKnowledgeEntry({
        productId,
        component: "coding",
        issueSummary: `lesson ${n}`,
      });

    const listed = await (
      await post("/api/library/wiki/tpd/gaps/rescan", {})
    ).json();
    const gap = listed.find((g: any) => g.kind === "unwritten");
    expect(gap.subject).toBe("Coding");

    const wikis = await (await get("/api/library/wiki")).json();
    expect(wikis.find((w: any) => w.product_slug === "tpd").open_gaps).toBe(1);

    expect(
      (await post(`/api/library/wiki/tpd/gaps/${gap.id}/dismiss`, {})).status,
    ).toBe(200);
    const after = await (await get("/api/library/wiki/tpd/gaps")).json();
    expect(after.gaps).toEqual([]);
    const counted = await (await get("/api/library/wiki")).json();
    expect(counted.find((w: any) => w.product_slug === "tpd").open_gaps).toBe(
      0,
    );
  });

  it("rejects 'gaps' and 'contents' as article slugs", async () => {
    for (const slug of ["gaps", "contents"])
      expect((await article("tpd", slug)).status).toBe(400);
  });
});
