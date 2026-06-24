import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveReferenceDoc, getReferenceDoc, listReferenceDocs, updateReferenceDoc,
  searchReferenceDocs, chunkText,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

describe("chunkText", () => {
  it("returns a single chunk for short text and splits long text", () => {
    expect(chunkText("short note")).toEqual(["short note"]);
    expect(chunkText("")).toEqual([]);
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with some filler words to add length.`).join("\n\n");
    const chunks = chunkText(long, { maxChars: 300, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 300 * 1.5)).toBe(true);
  });
});

describe("reference docs", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("saves a doc, chunks + embeds the body, and finds it semantically", async () => {
    const saved = await saveReferenceDoc({
      title: "Line Controller failover",
      body: "When the active line controller node loses its heartbeat, the standby promotes itself and replays the journal. Operators should not restart both nodes at once.",
      tags: ["lc", "runbook"],
    });
    expect(saved.chunks).toBeGreaterThanOrEqual(1);

    const [{ count }] = await sql`select count(*)::int as count from reference_doc_chunks where doc_id = ${saved.id}`;
    expect(count).toBe(saved.chunks);

    const hits = await searchReferenceDocs("what happens when the controller node heartbeat is lost");
    expect(hits[0].id).toBe(saved.id);
    expect(hits[0].snippet).toMatch(/heartbeat/i);
  });

  it("scopes search by product and filters by tag", async () => {
    const tpd = await tpdProductId();
    await saveReferenceDoc({ title: "Scoped", body: "aggregation station calibration steps", productId: tpd, tags: ["mas"] });
    await saveReferenceDoc({ title: "Unscoped", body: "aggregation station calibration steps", tags: ["other"] });

    const scoped = await searchReferenceDocs("aggregation station calibration", { productId: tpd });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].title).toBe("Scoped");

    const tagged = await searchReferenceDocs("aggregation station calibration", { tags: ["mas"] });
    expect(tagged).toHaveLength(1);
  });

  it("re-chunks and re-embeds when the body changes, and guards on version", async () => {
    const saved = await saveReferenceDoc({ title: "Doc", body: "original body about printers" });
    const before = await sql`select chunk_text from reference_doc_chunks where doc_id = ${saved.id} order by ordinal`;
    expect(before[0].chunk_text).toMatch(/printers/);

    await expect(updateReferenceDoc(saved.id, { body: "x", expectedVersion: 999 }))
      .rejects.toThrow(/Version conflict/);

    await updateReferenceDoc(saved.id, { body: "rewritten body about scanners", expectedVersion: 1 });
    const after = await sql`select chunk_text from reference_doc_chunks where doc_id = ${saved.id} order by ordinal`;
    expect(after[0].chunk_text).toMatch(/scanners/);
    expect(after[0].chunk_text).not.toMatch(/printers/);
  });

  it("lists newest-first and omits archived from search", async () => {
    const a = await saveReferenceDoc({ title: "A", body: "alpha content here" });
    await saveReferenceDoc({ title: "B", body: "beta content here" });
    const list = await listReferenceDocs();
    expect(list[0].title).toBe("B");

    await updateReferenceDoc(a.id, { status: "archived", expectedVersion: 1 });
    const doc = await getReferenceDoc(a.id);
    expect(doc.status).toBe("archived");
    const hits = await searchReferenceDocs("alpha content");
    expect(hits.find((h) => h.id === a.id)).toBeUndefined();
  });
});
