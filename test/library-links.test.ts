import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveReferenceDoc,
  updateReferenceDoc,
  saveKnowledgeEntry,
  updateKnowledgeEntry,
  outboundLinks,
  backlinks,
  parseWikilinks,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

const article = async (slug: string, body = "body", over: object = {}) =>
  saveReferenceDoc({
    productId: await tpdProductId(),
    kind: "wiki",
    slug,
    title: slug,
    body,
    ...over,
  });

describe("wikilink syntax", () => {
  it("reads a bare target, a label, and a typed reference", () => {
    expect(parseWikilinks("see [[spooler]] now")).toEqual([
      { target: "spooler", label: "spooler", kind: "article", ref: "spooler" },
    ]);
    expect(parseWikilinks("[[spooler|the spooler]]")[0]).toMatchObject({
      target: "spooler",
      label: "the spooler",
      kind: "article",
    });
    expect(parseWikilinks("[[entry:abc-123|SSO loop]]")[0]).toMatchObject({
      kind: "entry",
      ref: "abc-123",
      label: "SSO loop",
    });
  });

  it("ignores a single bracket and an unclosed link", () => {
    expect(parseWikilinks("[not a link] and [[unclosed")).toEqual([]);
  });

  it("finds several links on one line", () => {
    expect(parseWikilinks("[[a]] and [[b]]").map((l) => l.target)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("library links", () => {
  beforeEach(resetData);

  it("stores an edge when one article cites another", async () => {
    const target = await article("spooler-stalls");
    const source = await article("printing", "See [[spooler-stalls]].");

    const out = await outboundLinks({ docId: source.id });
    expect(out).toHaveLength(1);
    expect(out[0].to_doc_id).toBe(target.id);
    expect(out[0].to_title).toBe("spooler-stalls");

    const back = await backlinks({ docId: target.id });
    expect(back.map((b) => b.from_doc_id)).toEqual([source.id]);
  });

  it("stores an unresolved link rather than dropping it", async () => {
    const source = await article("printing", "See [[does-not-exist]].");
    const out = await outboundLinks({ docId: source.id });
    expect(out).toHaveLength(1);
    expect(out[0].to_doc_id).toBeNull();
    expect(out[0].target).toBe("does-not-exist");
    expect(out[0].to_title).toBeNull();
  });

  it("adopts links that were written before their target existed", async () => {
    const source = await article("printing", "See [[spooler-stalls]].");
    expect((await outboundLinks({ docId: source.id }))[0].to_doc_id).toBeNull();

    const target = await article("spooler-stalls");
    expect((await outboundLinks({ docId: source.id }))[0].to_doc_id).toBe(
      target.id,
    );
  });

  it("re-derives edges on every save", async () => {
    const a = await article("a");
    const b = await article("b");
    const source = await article("printing", "See [[a]].");
    expect(
      (await outboundLinks({ docId: source.id })).map((l) => l.to_doc_id),
    ).toEqual([a.id]);

    await updateReferenceDoc(source.id, { body: "See [[b]] instead." });
    expect(
      (await outboundLinks({ docId: source.id })).map((l) => l.to_doc_id),
    ).toEqual([b.id]);
  });

  it("collapses the same target twice in one body to one edge", async () => {
    await article("a");
    const source = await article("printing", "[[a]] and again [[a]].");
    expect(await outboundLinks({ docId: source.id })).toHaveLength(1);
  });

  /**
   * The obvious bug: rewriting a body must replace only the edges LEAVING it.
   * Deleting inbound edges here would silently unlink other people's articles.
   */
  it("editing a body leaves edges pointing AT it alone", async () => {
    const target = await article("spooler-stalls");
    const other = await article("printing", "See [[spooler-stalls]].");
    expect(await backlinks({ docId: target.id })).toHaveLength(1);

    await updateReferenceDoc(target.id, { body: "completely rewritten" });

    expect(await backlinks({ docId: target.id })).toHaveLength(1);
    expect((await backlinks({ docId: target.id }))[0].from_doc_id).toBe(
      other.id,
    );
  });

  it("links from a knowledge entry's prose", async () => {
    const target = await article("spooler-stalls");
    const entry = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      issueSummary: "printer stalls",
      resolution: "Follow [[spooler-stalls]].",
    });
    const back = await backlinks({ docId: target.id });
    expect(back.map((b) => b.from_entry_id)).toEqual([entry.id]);
    expect(back[0].from_kind).toBe("entry");
  });

  it("re-derives an entry's links when its resolution changes", async () => {
    const a = await article("a");
    await article("b");
    const entry = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      issueSummary: "x",
      resolution: "See [[a]].",
    });
    expect(await backlinks({ docId: a.id })).toHaveLength(1);

    await updateKnowledgeEntry(entry.id, { resolution: "See [[b]]." });
    expect(await backlinks({ docId: a.id })).toHaveLength(0);
  });

  it("points at a knowledge entry by id", async () => {
    const entry = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      issueSummary: "SSO loop after token refresh",
    });
    const source = await article(
      "auth",
      `See [[entry:${entry.id}|the SSO case]].`,
    );
    const out = await outboundLinks({ docId: source.id });
    expect(out[0].to_entry_id).toBe(entry.id);
    expect(out[0].label).toBe("the SSO case");
    expect(
      (await backlinks({ entryId: entry.id })).map((b) => b.from_doc_id),
    ).toEqual([source.id]);
  });

  it("does not resolve a malformed id to anything", async () => {
    const source = await article("auth", "See [[entry:not-a-uuid]].");
    expect(
      (await outboundLinks({ docId: source.id }))[0].to_entry_id,
    ).toBeNull();
  });

  it("falls back to the org-wide wiki when the product has no such article", async () => {
    const shared = await saveReferenceDoc({
      kind: "wiki",
      slug: "support-process",
      title: "Support process",
      body: "b",
    });
    const source = await article("printing", "See [[support-process]].");
    expect((await outboundLinks({ docId: source.id }))[0].to_doc_id).toBe(
      shared.id,
    );
  });

  it("prefers the product's own article over the org-wide one", async () => {
    await saveReferenceDoc({
      kind: "wiki",
      slug: "glossary",
      title: "Org glossary",
      body: "b",
    });
    const mine = await article("glossary", "product glossary");
    const source = await article("printing", "See [[glossary]].");
    expect((await outboundLinks({ docId: source.id }))[0].to_doc_id).toBe(
      mine.id,
    );
  });

  it("goes away with the item that wrote it", async () => {
    const target = await article("spooler-stalls");
    const source = await article("printing", "See [[spooler-stalls]].");
    await sql`delete from reference_docs where id = ${source.id}`;
    expect(await backlinks({ docId: target.id })).toHaveLength(0);
  });
});
