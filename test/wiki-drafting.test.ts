import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addWikiCategory,
  draftSources,
  saveKnowledgeEntry,
  saveReferenceDoc,
  updateReferenceDoc,
  setComposedFrom,
  articleStaleness,
  wikiToc,
  sql as coreSql,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

async function tree() {
  const productId = await tpdProductId();
  await addComponent({ productId, slug: "printing", name: "Printing" });
  await addComponent({
    productId,
    slug: "spooler",
    name: "Spooler",
    parentSlug: "printing",
  });
  await addComponent({ productId, slug: "coding", name: "Coding" });
  return productId;
}

describe("draft sources", () => {
  beforeEach(resetData);

  it("gathers the substance under a component, not just ids", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "spooler stalls at 023",
      rootCause: "buffer overrun",
      resolution: "restart the spooler",
    });

    const [s] = await draftSources(productId, "printing");
    expect(s.kind).toBe("entry");
    expect(s.title).toBe("spooler stalls at 023");
    expect(s.body).toContain("buffer overrun");
    expect(s.body).toContain("restart the spooler");
  });

  /** A lesson filed against a sub-component is still about the parent topic. */
  it("includes the component's sub-components", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "spooler",
      issueSummary: "child lesson",
    });
    expect(
      (await draftSources(productId, "printing")).map((s) => s.title),
    ).toEqual(["child lesson"]);
  });

  it("does not reach into a sibling component", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "coding",
      issueSummary: "unrelated",
    });
    expect(await draftSources(productId, "printing")).toEqual([]);
  });

  it("gathers imported docs alongside entries, but never articles", async () => {
    const productId = await tree();
    await saveReferenceDoc({
      productId,
      component: "printing",
      title: "Printer runbook",
      body: "steps",
    });
    await saveReferenceDoc({
      productId,
      component: "printing",
      kind: "wiki",
      slug: "printing-guide",
      title: "Printing guide",
      body: "already written",
    });

    const got = await draftSources(productId, "printing");
    expect(got.map((s) => s.title)).toEqual(["Printer runbook"]);
  });

  it("skips drafts and rejected material", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "rejected",
      status: "rejected",
    });
    expect(await draftSources(productId, "printing")).toEqual([]);
  });

  it("refuses an unknown component rather than returning nothing", async () => {
    const productId = await tree();
    await expect(draftSources(productId, "nope")).rejects.toThrow(
      /No component/,
    );
  });
});

describe("composed-from provenance", () => {
  beforeEach(resetData);

  const page = async (productId: string) =>
    saveReferenceDoc({
      productId,
      kind: "wiki",
      slug: "printing-guide",
      title: "Printing guide",
      body: "composed",
    });

  it("records what an article was built from", async () => {
    const productId = await tree();
    const entry = await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "a lesson",
    });
    const doc = await saveReferenceDoc({
      productId,
      component: "printing",
      title: "a runbook",
      body: "b",
    });
    const article = await page(productId);

    await setComposedFrom(coreSql, article.id, [
      { entryId: entry.id },
      { docId: doc.id },
    ]);

    const built = await articleStaleness(article.id);
    expect(built).toMatchObject({
      sources: 2,
      entries: 1,
      docs: 1,
      changed: 0,
    });
  });

  it("flags a source that moved after the article was written", async () => {
    const productId = await tree();
    const entry = await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "a lesson",
    });
    const article = await page(productId);
    await setComposedFrom(coreSql, article.id, [{ entryId: entry.id }]);
    expect((await articleStaleness(article.id)).changed).toBe(0);

    // updated_at is trigger-managed, so it cannot be backdated: the trigger
    // overwrites any value with now(), and now() is transaction-scoped. Two
    // separate statements therefore give the source a strictly later timestamp
    // than the article — which is the real-world sequence being modelled.
    await sql`update reference_docs set title = title where id = ${article.id}`;
    await sql`update knowledge_entries set issue_summary = issue_summary
              where id = ${entry.id}`;

    const built = await articleStaleness(article.id);
    expect(built.changed).toBe(1);
    expect(built.changedTitles).toEqual(["a lesson"]);
  });

  it("replaces the source set wholesale rather than accumulating", async () => {
    const productId = await tree();
    const a = await saveKnowledgeEntry({ productId, issueSummary: "a" });
    const b = await saveKnowledgeEntry({ productId, issueSummary: "b" });
    const article = await page(productId);

    await setComposedFrom(coreSql, article.id, [
      { entryId: a.id },
      { entryId: b.id },
    ]);
    expect((await articleStaleness(article.id)).sources).toBe(2);

    await setComposedFrom(coreSql, article.id, [{ entryId: b.id }]);
    expect((await articleStaleness(article.id)).sources).toBe(1);
  });

  it("does not let an article be its own source", async () => {
    const productId = await tree();
    const article = await page(productId);
    await setComposedFrom(coreSql, article.id, [{ docId: article.id }]);
    expect((await articleStaleness(article.id)).sources).toBe(0);
  });

  /** Provenance and prose citations are different things and must not mix. */
  it("keeps composed_from separate from the body's [[links]]", async () => {
    const productId = await tree();
    const entry = await saveKnowledgeEntry({
      productId,
      issueSummary: "a lesson",
    });
    const article = await page(productId);
    await setComposedFrom(coreSql, article.id, [{ entryId: entry.id }]);

    // Re-saving the body re-derives 'mentions' and must leave provenance alone.
    await updateReferenceDoc(article.id, { body: "no links here at all" });
    expect((await articleStaleness(article.id)).sources).toBe(1);
  });

  it("cannot be fooled by a backdated timestamp", async () => {
    const productId = await tree();
    const entry = await saveKnowledgeEntry({
      productId,
      issueSummary: "a lesson",
    });
    const article = await page(productId);
    await setComposedFrom(coreSql, article.id, [{ entryId: entry.id }]);

    // The trigger rewrites updated_at on every update, so this is a no-op —
    // asserting it keeps the staleness tests honest about their mechanism.
    await sql`update reference_docs set updated_at = now() - interval '1 day'
              where id = ${article.id}`;
    const [row] =
      await sql`select updated_at from reference_docs where id = ${article.id}`;
    expect(Date.now() - Date.parse(row.updated_at)).toBeLessThan(60_000);
  });

  it("surfaces staleness on the table of contents", async () => {
    const productId = await tree();
    await addWikiCategory({ productId, slug: "guides", name: "Guides" });
    const entry = await saveKnowledgeEntry({
      productId,
      issueSummary: "a lesson",
    });
    const article = await page(productId);
    await setComposedFrom(coreSql, article.id, [{ entryId: entry.id }]);
    await sql`update reference_docs set title = title where id = ${article.id}`;
    await sql`update knowledge_entries set issue_summary = issue_summary
              where id = ${entry.id}`;

    const toc = await wikiToc(productId);
    expect(toc.uncategorised[0]).toMatchObject({ stale: 1 });
  });
});
