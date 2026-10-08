import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addComponent } from "@tachy/core/catalog";
import {
  addWikiCategory,
  updateWikiCategory,
  deleteWikiCategory,
  listWikiCategories,
  setCategoryComponents,
  seedSectionsFromComponents,
  searchWikiArticles,
  wikiToc,
  articleCategories,
  setArticleCategories,
  findArticle,
  findMainPage,
} from "@tachy/core/wiki";
import {
  saveReferenceDoc,
  updateReferenceDoc,
  listReferenceDocs,
  searchReferenceDocs,
  getReferenceDoc,
} from "@tachy/core/reference";
import { listRevisions } from "@tachy/core/library";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const article = async (slug: string, over: Record<string, unknown> = {}) =>
  saveReferenceDoc({
    productId: await tpdProductId(),
    kind: "wiki",
    slug,
    title: slug,
    body: "body",
    ...over,
  });

describe("wiki categories", () => {
  beforeEach(resetData);

  it("nests and lists per wiki", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({
      productId: productId,
      slug: "trouble",
      name: "Troubleshooting",
    });
    await addWikiCategory({
      productId: productId,
      slug: "printing",
      name: "Printing",
      parentSlug: "trouble",
    });
    const rows = await listWikiCategories(productId);
    expect(rows.map((r) => r.slug).sort()).toEqual(["printing", "trouble"]);
    const printing = rows.find((r) => r.slug === "printing")!;
    const trouble = rows.find((r) => r.slug === "trouble")!;
    expect(printing.parent_id).toBe(trouble.id);
  });

  it("keeps the org-wide wiki separate from a product's", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({
      productId: productId,
      slug: "shared",
      name: "In product",
    });
    await addWikiCategory({
      productId: null,
      slug: "shared",
      name: "Org wide",
    });
    expect((await listWikiCategories(productId)).map((r) => r.name)).toEqual([
      "In product",
    ]);
    expect((await listWikiCategories(null)).map((r) => r.name)).toEqual([
      "Org wide",
    ]);
  });

  it("refuses a re-parent that would make a cycle", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    await addWikiCategory({
      productId: productId,
      slug: "b",
      name: "B",
      parentSlug: "a",
    });
    await addWikiCategory({
      productId: productId,
      slug: "c",
      name: "C",
      parentSlug: "b",
    });
    await expect(
      updateWikiCategory(productId, "a", { parentSlug: "c" }),
    ).rejects.toThrow(/cycle/);
  });

  it("refuses to be its own parent", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    await expect(
      updateWikiCategory(productId, "a", { parentSlug: "a" }),
    ).rejects.toThrow(/own parent/);
  });

  it("flattens a branch on delete rather than dropping the subtree", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    await addWikiCategory({
      productId: productId,
      slug: "b",
      name: "B",
      parentSlug: "a",
    });
    await addWikiCategory({
      productId: productId,
      slug: "c",
      name: "C",
      parentSlug: "b",
    });
    await deleteWikiCategory(productId, "b");
    const rows = await listWikiCategories(productId);
    expect(rows.map((r) => r.slug).sort()).toEqual(["a", "c"]);
    const found = rows.find((r) => r.slug === "a")!;
    expect(rows.find((r) => r.slug === "c")!.parent_id).toBe(found.id);
  });

  it("rejects a slug that is not a slug", async () => {
    const productId = await tpdProductId();
    await expect(
      addWikiCategory({ productId: productId, slug: "Not A Slug", name: "x" }),
    ).rejects.toThrow(/Invalid category slug/);
  });
});

describe("wiki articles", () => {
  beforeEach(resetData);

  it("is addressable by slug and keeps its id across edits", async () => {
    const page = await article("printing");
    const found = await findArticle(await tpdProductId(), "printing");
    expect(found.id).toBe(page.id);

    await updateReferenceDoc(page.id, { body: "rewritten" });
    const again = await findArticle(await tpdProductId(), "printing");
    expect(again.id).toBe(page.id);
    expect(again.body).toBe("rewritten");
  });

  it("refuses reserved and malformed slugs", async () => {
    await expect(article("toc")).rejects.toThrow(/reserved/);
    await expect(article("c")).rejects.toThrow(/reserved/);
    await expect(article("Not A Slug")).rejects.toThrow(/Invalid article slug/);
  });

  it("needs a slug at all", async () => {
    await expect(
      saveReferenceDoc({
        productId: await tpdProductId(),
        kind: "wiki",
        title: "no slug",
        body: "b",
      }),
    ).rejects.toThrow(/needs a slug/);
  });

  it("rejects a second live article at the same slug", async () => {
    await article("printing");
    await expect(article("printing")).rejects.toThrow();
  });

  it("keeps org-wide slugs unique among themselves, separate from a product's", async () => {
    await article("printing");
    const orgWide = await saveReferenceDoc({
      kind: "wiki",
      slug: "printing",
      title: "org wide printing",
      body: "b",
    });
    expect(orgWide.id).toBeTruthy();
    expect((await findArticle(null, "printing")).id).toBe(orgWide.id);
  });

  it("never clears a slug on update - that would orphan its links", async () => {
    const page = await article("printing");
    await updateReferenceDoc(page.id, { slug: null });
    expect((await getReferenceDoc(page.id)).slug).toBe("printing");
  });

  it("is searchable, but not listed in the docs shelf", async () => {
    await article("spooler", {
      title: "Spooler subsystem",
      body: "the spooler stalls when the queue overruns",
    });
    await saveReferenceDoc({
      productId: await tpdProductId(),
      title: "An imported doc",
      body: "unrelated prose",
    });

    const listed = await listReferenceDocs({});
    expect(listed.map((d: any) => d.title)).toEqual(["An imported doc"]);

    const both = await listReferenceDocs({ kind: "any" });
    expect(both).toHaveLength(2);

    const hits = await searchReferenceDocs("spooler stalls queue");
    expect(hits.map((h: any) => h.title)).toContain("Spooler subsystem");
  });

  it("narrows search to one shelf when asked", async () => {
    await article("spooler", {
      title: "Spooler article",
      body: "spooler prose",
    });
    const onlyWiki = await searchReferenceDocs("spooler", { kind: "wiki" });
    expect(onlyWiki.map((h: any) => h.title)).toEqual(["Spooler article"]);
    const onlyDocs = await searchReferenceDocs("spooler", {
      kind: "reference",
    });
    expect(onlyDocs).toHaveLength(0);
  });

  it("carries a revision history like any other doc", async () => {
    const page = await article("printing");
    await updateReferenceDoc(page.id, { body: "v2" });
    const revs = await listRevisions({ docId: page.id });
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
  });

  it("has no main page until one is written", async () => {
    const productId = await tpdProductId();
    expect(await findMainPage(productId)).toBeNull();
    await article("main", { title: "TPD Wiki" });
    expect((await findMainPage(productId))!.title).toBe("TPD Wiki");
  });
});

describe("the general table of contents", () => {
  beforeEach(resetData);

  it("nests categories and files an article under every one it belongs to", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({
      productId: productId,
      slug: "trouble",
      name: "Troubleshooting",
    });
    await addWikiCategory({
      productId: productId,
      slug: "printing",
      name: "Printing",
      parentSlug: "trouble",
    });
    await addWikiCategory({
      productId: productId,
      slug: "hardware",
      name: "Hardware",
    });

    const page = await article("spooler-stalls", { title: "Spooler stalls" });
    await setArticleCategories(productId, page.id, ["printing", "hardware"]);

    const toc = await wikiToc(productId);
    const trouble = toc.categories.find((c) => c.slug === "trouble")!;
    const printing = trouble.children.find((c) => c.slug === "printing")!;
    const hardware = toc.categories.find((c) => c.slug === "hardware")!;

    expect(printing.articles.map((x) => x.title)).toEqual(["Spooler stalls"]);
    expect(hardware.articles.map((x) => x.title)).toEqual(["Spooler stalls"]);

    // Filed twice, stored once.
    const [{ count }] =
      await sql`select count(*)::int as count from reference_docs where kind = 'wiki'`;
    expect(count).toBe(1);
  });

  it("collects articles filed under nothing", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({
      productId: productId,
      slug: "trouble",
      name: "Troubleshooting",
    });
    const filed = await article("filed");
    await setArticleCategories(productId, filed.id, ["trouble"]);
    await article("loose");

    const toc = await wikiToc(productId);
    expect(toc.uncategorised.map((a) => a.slug)).toEqual(["loose"]);
  });

  it("replaces memberships wholesale rather than accumulating them", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    await addWikiCategory({ productId: productId, slug: "b", name: "B" });
    const doc = await article("x");

    await setArticleCategories(productId, doc.id, ["a", "b"]);
    expect((await articleCategories(doc.id)).map((c) => c.slug).sort()).toEqual(
      ["a", "b"],
    );

    await setArticleCategories(productId, doc.id, ["b"]);
    expect((await articleCategories(doc.id)).map((c) => c.slug)).toEqual(["b"]);

    await setArticleCategories(productId, doc.id, []);
    expect(await articleCategories(doc.id)).toEqual([]);
  });

  it("keeps memberships across an edit, because the id survives", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    const doc = await article("x");
    await setArticleCategories(productId, doc.id, ["a"]);
    await updateReferenceDoc(doc.id, { body: "changed" });
    expect((await articleCategories(doc.id)).map((c) => c.slug)).toEqual(["a"]);
  });

  it("drops memberships when the article goes", async () => {
    const productId = await tpdProductId();
    await addWikiCategory({ productId: productId, slug: "a", name: "A" });
    const doc = await article("x");
    await setArticleCategories(productId, doc.id, ["a"]);
    await sql`delete from reference_docs where id = ${doc.id}`;
    const toc = await wikiToc(productId);
    expect(toc.categories[0].articles).toEqual([]);
  });
});

describe("wiki sections (categories that cooperate with components)", () => {
  beforeEach(resetData);

  it("carries a lead article and covered components through the toc", async () => {
    const productId = await tpdProductId();
    await addComponent({
      productId: productId,
      slug: "portal",
      name: "Portal",
    });
    await addComponent({ productId: productId, slug: "hub", name: "HUB" });
    await article("portal");
    await addWikiCategory({
      productId: productId,
      slug: "portal",
      name: "Portal",
      leadSlug: "portal",
      componentSlugs: ["portal", "hub"],
    });
    const [row] = await listWikiCategories(productId);
    expect(row.lead_slug).toBe("portal");
    expect(row.lead_title).toBe("portal");
    expect(row.components.map((c) => c.slug).sort()).toEqual(["hub", "portal"]);

    const toc = await wikiToc(productId);
    expect(toc.categories[0].lead_slug).toBe("portal");
    expect(toc.categories[0].components).toHaveLength(2);
  });

  it("replaces the covered set whole and clears the lead when asked", async () => {
    const productId = await tpdProductId();
    await addComponent({
      productId: productId,
      slug: "portal",
      name: "Portal",
    });
    await addComponent({
      productId: productId,
      slug: "backend",
      name: "Backend",
    });
    await article("backend");
    const cat = await addWikiCategory({
      productId: productId,
      slug: "s",
      name: "S",
      leadSlug: "backend",
      componentSlugs: ["portal"],
    });
    await setCategoryComponents(productId, cat.id, ["backend"]);
    let [row] = await listWikiCategories(productId);
    expect(row.components.map((c) => c.slug)).toEqual(["backend"]);

    await updateWikiCategory(productId, "s", {
      leadSlug: null,
      componentSlugs: [],
    });
    [row] = await listWikiCategories(productId);
    expect(row.lead_slug).toBeNull();
    expect(row.components).toEqual([]);
  });

  it("seeds one section per top-level component and is re-runnable", async () => {
    const productId = await tpdProductId();
    await addComponent({
      productId: productId,
      slug: "portal",
      name: "Portal",
    });
    await addComponent({
      productId: productId,
      slug: "backend",
      name: "Backend",
    });
    await addComponent({
      productId: productId,
      slug: "worker",
      name: "Worker",
      parentSlug: "backend",
    });

    const first = await seedSectionsFromComponents(productId);
    expect(first.created.map((c) => c.slug).sort()).toEqual([
      "backend",
      "portal",
    ]);
    const rows = await listWikiCategories(productId);
    // The child component does not seed its own section.
    expect(rows.map((r) => r.slug).sort()).toEqual(["backend", "portal"]);
    // Each section is linked to the component it came from.
    const backend = rows.find((r) => r.slug === "backend")!;
    expect(backend.components.map((c) => c.slug)).toEqual(["backend"]);

    // Re-running leaves the curated set untouched.
    const again = await seedSectionsFromComponents(productId);
    expect(again.created).toEqual([]);
    expect(await listWikiCategories(productId)).toHaveLength(2);
  });

  it("searches this wiki's articles, drafts included, scoped to the wiki", async () => {
    const productId = await tpdProductId();
    await article("spooler-stalls", {
      title: "Spooler stalls",
      body: "the print spooler stops responding",
      status: "draft",
    });
    await article("other", { title: "Something else", body: "unrelated" });
    // An article in a different wiki must not leak in.
    await saveReferenceDoc({
      productId: null,
      kind: "wiki",
      slug: "spooler-note",
      title: "Spooler note",
      body: "org-wide spooler note",
    });

    const hits = await searchWikiArticles(productId, "spooler");
    expect(hits.map((h) => h.slug)).toEqual(["spooler-stalls"]);
    expect(hits[0].status).toBe("draft");
    expect(await searchWikiArticles(productId, "")).toEqual([]);
  });
});
