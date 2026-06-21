import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveKnowledgeEntry, searchKnowledge } from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

describe("searchKnowledge", () => {
  beforeEach(resetData);

  it("ranks the relevant approved entry first and never returns drafts", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Barcode scanner stays offline after firmware update",
      symptoms: ["scanner offline", "error E-204"],
      rootCause: "firmware regression",
      resolution: "roll back firmware to 1.4.2",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Invoice export produces empty PDF",
      resolution: "clear the export cache",
    });
    await saveKnowledgeEntry({
      status: "draft",
      issueSummary: "scanner offline draft that must not surface",
    });

    const rows = await searchKnowledge("scanner offline E-204");
    expect(rows[0].issue_summary).toMatch(/scanner/i);
    expect(rows.every((r) => r.status === "approved")).toBe(true);
    expect(rows.some((r) => r.issue_summary.includes("draft"))).toBe(false);
  });

  it("finds a semantic match even with no shared keywords", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Handheld barcode reader will not connect after a software upgrade",
      resolution: "reinstall the device driver",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Monthly invoice PDF is blank",
      resolution: "clear the export cache",
    });

    // No literal word overlap with the first entry; relies on embeddings.
    const rows = await searchKnowledge("scanner offline");
    expect(rows[0].issue_summary).toMatch(/barcode reader/i);
  });

  it("scopes by product_id", async () => {
    const tpd = await tpdProductId();
    await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "tpd tracking gap" });
    await saveKnowledgeEntry({ status: "approved", issueSummary: "tracking gap elsewhere" });

    const scoped = await searchKnowledge("tracking gap", { productId: tpd });
    expect(scoped.length).toBe(1);
    expect(scoped[0].issue_summary).toBe("tpd tracking gap");
  });

  it("finds an entry by a signal (error code) with no other keyword overlap", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Label printing fails during rework",
      signals: ["023", "TOO_MANY_STRINGS", "application-provisioning.yml"],
    });
    await saveKnowledgeEntry({ status: "approved", issueSummary: "Unrelated invoice export bug" });

    const rows = await searchKnowledge("TOO_MANY_STRINGS");
    expect(rows[0].issue_summary).toMatch(/Label printing/i);
    expect(rows[0].signals).toContain("TOO_MANY_STRINGS");
  });
});

describe("knowledge_entries constraints", () => {
  beforeEach(resetData);

  it("normalizes confidence case so filtering by lowercase always works", async () => {
    const row = await saveKnowledgeEntry({ issueSummary: "x", confidence: "HIGH" });
    const [stored] = await sql`select confidence from knowledge_entries where id = ${row.id}`;
    expect(stored.confidence).toBe("high");
  });

  it("rejects an invalid confidence value at the DB level", async () => {
    await expect(
      sql`insert into knowledge_entries (issue_summary, confidence) values ('x', 'super-high')`,
    ).rejects.toThrow();
  });

  it("rejects an invalid status value at the DB level", async () => {
    await expect(
      sql`insert into knowledge_entries (issue_summary, status) values ('x', 'not-a-status')`,
    ).rejects.toThrow();
  });
});
