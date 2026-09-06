import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addWikiCategory,
  updateWikiCategory,
  deleteWikiCategory,
  listWikiCategories,
  wikiToc,
  articleCategories,
  setArticleCategories,
  findArticle,
  findMainPage,
  saveReferenceDoc,
  updateReferenceDoc,
  listReferenceDocs,
  searchReferenceDocs,
  getReferenceDoc,
  listRevisions,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

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
    const p = await tpdProductId();
    await addWikiCategory({
      productId: p,
      slug: "trouble",
      name: "Troubleshooting",
    });
    await addWikiCategory({
      productId: p,
      slug: "printing",
      name: "Printing",
      parentSlug: "trouble",
    });
    const rows = await listWikiCategories(p);
    expect(rows.map((r) => r.slug).sort()).toEqual(["printing", "trouble"]);
    const printing = rows.find((r) => r.slug === "printing")!;
    const trouble = rows.find((r) => r.slug === "trouble")!;
    expect(printing.parent_id).toBe(trouble.id);
  });

  it("keeps the org-wide wiki separate from a product's", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "shared", name: "In product" });
    await addWikiCategory({
      productId: null,
      slug: "shared",
      name: "Org wide",
    });
    expect((await listWikiCategories(p)).map((r) => r.name)).toEqual([
      "In product",
    ]);
    expect((await listWikiCategories(null)).map((r) => r.name)).toEqual([
      "Org wide",
    ]);
  });

  it("refuses a re-parent that would make a cycle", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    await addWikiCategory({
      productId: p,
      slug: "b",
      name: "B",
      parentSlug: "a",
    });
    await addWikiCategory({
      productId: p,
      slug: "c",
      name: "C",
      parentSlug: "b",
    });
    await expect(
      updateWikiCategory(p, "a", { parentSlug: "c" }),
    ).rejects.toThrow(/cycle/);
  });

  it("refuses to be its own parent", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    await expect(
      updateWikiCategory(p, "a", { parentSlug: "a" }),
    ).rejects.toThrow(/own parent/);
  });

  it("flattens a branch on delete rather than dropping the subtree", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    await addWikiCategory({
      productId: p,
      slug: "b",
      name: "B",
      parentSlug: "a",
    });
    await addWikiCategory({
      productId: p,
      slug: "c",
      name: "C",
      parentSlug: "b",
    });
    await deleteWikiCategory(p, "b");
    const rows = await listWikiCategories(p);
    expect(rows.map((r) => r.slug).sort()).toEqual(["a", "c"]);
    const a = rows.find((r) => r.slug === "a")!;
    expect(rows.find((r) => r.slug === "c")!.parent_id).toBe(a.id);
  });

  it("rejects a slug that is not a slug", async () => {
    const p = await tpdProductId();
    await expect(
      addWikiCategory({ productId: p, slug: "Not A Slug", name: "x" }),
    ).rejects.toThrow(/Invalid category slug/);
  });
});

describe("wiki articles", () => {
  beforeEach(resetData);

  it("is addressable by slug and keeps its id across edits", async () => {
    const a = await article("printing");
    const found = await findArticle(await tpdProductId(), "printing");
    expect(found.id).toBe(a.id);

    await updateReferenceDoc(a.id, { body: "rewritten" });
    const again = await findArticle(await tpdProductId(), "printing");
    expect(again.id).toBe(a.id);
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

  it("never clears a slug on update — that would orphan its links", async () => {
    const a = await article("printing");
    await updateReferenceDoc(a.id, { slug: null });
    expect((await getReferenceDoc(a.id)).slug).toBe("printing");
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
    const a = await article("printing");
    await updateReferenceDoc(a.id, { body: "v2" });
    const revs = await listRevisions({ docId: a.id });
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
  });

  it("has no main page until one is written", async () => {
    const p = await tpdProductId();
    expect(await findMainPage(p)).toBeNull();
    await article("main", { title: "TPD Wiki" });
    expect((await findMainPage(p))!.title).toBe("TPD Wiki");
  });
});

describe("the general table of contents", () => {
  beforeEach(resetData);

  it("nests categories and files an article under every one it belongs to", async () => {
    const p = await tpdProductId();
    await addWikiCategory({
      productId: p,
      slug: "trouble",
      name: "Troubleshooting",
    });
    await addWikiCategory({
      productId: p,
      slug: "printing",
      name: "Printing",
      parentSlug: "trouble",
    });
    await addWikiCategory({ productId: p, slug: "hardware", name: "Hardware" });

    const a = await article("spooler-stalls", { title: "Spooler stalls" });
    await setArticleCategories(p, a.id, ["printing", "hardware"]);

    const toc = await wikiToc(p);
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
    const p = await tpdProductId();
    await addWikiCategory({
      productId: p,
      slug: "trouble",
      name: "Troubleshooting",
    });
    const filed = await article("filed");
    await setArticleCategories(p, filed.id, ["trouble"]);
    await article("loose");

    const toc = await wikiToc(p);
    expect(toc.uncategorised.map((a) => a.slug)).toEqual(["loose"]);
  });

  it("replaces memberships wholesale rather than accumulating them", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    await addWikiCategory({ productId: p, slug: "b", name: "B" });
    const doc = await article("x");

    await setArticleCategories(p, doc.id, ["a", "b"]);
    expect((await articleCategories(doc.id)).map((c) => c.slug).sort()).toEqual(
      ["a", "b"],
    );

    await setArticleCategories(p, doc.id, ["b"]);
    expect((await articleCategories(doc.id)).map((c) => c.slug)).toEqual(["b"]);

    await setArticleCategories(p, doc.id, []);
    expect(await articleCategories(doc.id)).toEqual([]);
  });

  it("keeps memberships across an edit, because the id survives", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    const doc = await article("x");
    await setArticleCategories(p, doc.id, ["a"]);
    await updateReferenceDoc(doc.id, { body: "changed" });
    expect((await articleCategories(doc.id)).map((c) => c.slug)).toEqual(["a"]);
  });

  it("drops memberships when the article goes", async () => {
    const p = await tpdProductId();
    await addWikiCategory({ productId: p, slug: "a", name: "A" });
    const doc = await article("x");
    await setArticleCategories(p, doc.id, ["a"]);
    await sql`delete from reference_docs where id = ${doc.id}`;
    const toc = await wikiToc(p);
    expect(toc.categories[0].articles).toEqual([]);
  });
});
