import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  searchKnowledge,
  updateKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  addFeedback,
  listEnvironments,
} from "@tachy/core";
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
      issueSummary:
        "Handheld barcode reader will not connect after a software upgrade",
      resolution: "reinstall the device driver",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Monthly invoice PDF is blank",
      resolution: "clear the export cache",
    });

    const rows = await searchKnowledge("scanner offline");
    expect(rows[0].issue_summary).toMatch(/barcode reader/i);
  });

  it("scopes by product_id", async () => {
    const tpd = await tpdProductId();
    await saveKnowledgeEntry({
      status: "approved",
      productId: tpd,
      issueSummary: "tpd tracking gap",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "tracking gap elsewhere",
    });

    const scoped = await searchKnowledge("tracking gap", { productId: tpd });
    expect(scoped.length).toBe(1);
    expect(scoped[0].issue_summary).toBe("tpd tracking gap");

    const withUnscoped = await searchKnowledge("tracking gap", {
      productId: tpd,
      includeUnscoped: true,
    });
    expect(withUnscoped.map((r) => r.issue_summary).sort()).toEqual([
      "tpd tracking gap",
      "tracking gap elsewhere",
    ]);
  });

  it("finds an entry by a signal (error code) with no other keyword overlap", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Label printing fails during rework",
      signals: ["023", "TOO_MANY_STRINGS", "application-provisioning.yml"],
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "Unrelated invoice export bug",
    });

    const rows = await searchKnowledge("TOO_MANY_STRINGS");
    expect(rows[0].issue_summary).toMatch(/Label printing/i);
    expect(rows[0].signals).toContain("TOO_MANY_STRINGS");
  });
});

describe("knowledge_entries constraints", () => {
  beforeEach(resetData);

  it("normalizes confidence case so filtering by lowercase always works", async () => {
    const row = await saveKnowledgeEntry({
      issueSummary: "x",
      confidence: "HIGH",
    });
    const [stored] =
      await sql`select confidence from knowledge_entries where id = ${row.id}`;
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

describe("promoted facets (cloud / quality)", () => {
  beforeEach(resetData);

  it("stores and filters approved entries by cloud", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "prod outage in pipeline",
      cloud: "prod",
      learningValue: "high",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "qa pipeline flake",
      cloud: "qa",
    });

    const prod = await searchKnowledge("pipeline", { cloud: "prod" });
    expect(prod.length).toBe(1);
    expect(prod[0].cloud).toBe("prod");
    expect(prod[0].learning_value).toBe("high");
  });

  it("round-trips facets and lets update clear them with null", async () => {
    const row = await saveKnowledgeEntry({
      issueSummary: "x",
      cloud: "on-prem",
      hiddenFix: true,
      resolutionClarity: "clear",
    });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.cloud).toBe("on-prem");
    expect(stored.hidden_fix).toBe(true);

    await updateKnowledgeEntry(row.id, { cloud: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.cloud).toBeNull();
    expect(stored.hidden_fix).toBe(true);
  });

  it("round-trips affected/fixed version, seeds from the work item, and filters on them", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "broken in 2.3",
      affectedVersion: "2.3.0",
      fixedVersion: "2.4.0",
    });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.affected_version).toBe("2.3.0");
    expect(stored.fixed_version).toBe("2.4.0");
    await updateKnowledgeEntry(row.id, { fixedVersion: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.fixed_version).toBeNull();
    expect(stored.affected_version).toBe("2.3.0");

    const [conn] =
      await sql`select id from source_connections where slug = 'test-freshdesk'`;
    const [wi] = await sql`
      insert into work_items (source_connection_id, external_id, title, observed_version)
      values (${conn.id}, 'v-1', 'versioned ticket', '1.9.2') returning id
    `;
    const seeded = await saveKnowledgeEntry({
      workItemId: wi.id as string,
      issueSummary: "seeded",
    });
    expect((await getKnowledgeEntry(seeded.id)).affected_version).toBe("1.9.2");

    const hits = await listKnowledgeEntries({ affectedVersion: "2.3.0" });
    expect(hits.map((h) => h.id)).toEqual([row.id]);
  });

  it("accepts deployment-specific environments and lists them with counts", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "a",
      cloud: "demo/preprod",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "b",
      cloud: "demo/preprod",
    });
    await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "c",
      cloud: "dev",
    });
    await saveKnowledgeEntry({
      status: "archived",
      issueSummary: "d",
      cloud: "gone",
    });

    const envs = await listEnvironments();
    expect(envs).toEqual([
      { cloud: "demo/preprod", count: 2 },
      { cloud: "dev", count: 1 },
    ]);
  });
});

describe("deprecation lifecycle", () => {
  beforeEach(resetData);

  it("deprecated entries surface in search flagged, archived ones do not", async () => {
    const old = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "scanner offline after firmware update",
    });
    const fresh = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "scanner offline: reflash with tool v2",
    });
    await saveKnowledgeEntry({
      status: "archived",
      issueSummary: "scanner offline lesson that must stay hidden",
    });
    await updateKnowledgeEntry(old.id, {
      status: "deprecated",
      supersededBy: fresh.id,
    });

    const rows = await searchKnowledge("scanner offline");
    const deprecated = rows.find((r) => r.id === old.id);
    expect(deprecated).toBeDefined();
    expect(deprecated!.status).toBe("deprecated");
    expect(deprecated!.superseded_by).toBe(fresh.id);
    expect(rows.some((r) => r.issue_summary.includes("hidden"))).toBe(false);
  });

  it("validates the supersede link: unknown target and self-reference are rejected", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "x",
    });
    await expect(
      updateKnowledgeEntry(row.id, {
        supersededBy: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      updateKnowledgeEntry(row.id, { supersededBy: row.id }),
    ).rejects.toThrow(/supersede itself/);

    await expect(
      sql`update knowledge_entries set superseded_by = id where id = ${row.id}`,
    ).rejects.toThrow();
  });

  it("clears the supersede link with null and allows re-approving", async () => {
    const old = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "old lesson",
    });
    const fresh = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "new lesson",
    });
    await updateKnowledgeEntry(old.id, {
      status: "deprecated",
      supersededBy: fresh.id,
    });

    await updateKnowledgeEntry(old.id, {
      status: "approved",
      supersededBy: null,
    });
    const stored = await getKnowledgeEntry(old.id);
    expect(stored.status).toBe("approved");
    expect(stored.superseded_by).toBeNull();
  });

  it("accepts feedback kind 'deprecation' and rejects unknown kinds at the DB level", async () => {
    const row = await saveKnowledgeEntry({
      status: "approved",
      issueSummary: "x",
    });
    const fb = await addFeedback({
      knowledgeEntryId: row.id,
      kind: "deprecation",
      comment: "fixed since v2.3",
    });
    expect(fb.kind).toBe("deprecation");
    await expect(
      sql`insert into knowledge_feedback (knowledge_entry_id, kind) values (${row.id}, 'bogus')`,
    ).rejects.toThrow();
  });
});

describe("structured validation", () => {
  beforeEach(resetData);

  it("rejects a malformed structured field with a bad_input error", async () => {
    await expect(
      saveKnowledgeEntry({
        issueSummary: "x",
        structured: { investigation_steps: "not-an-array" },
      }),
    ).rejects.toThrow(/Invalid structured field/i);
  });

  it("keeps unknown structured keys (passthrough)", async () => {
    const row = await saveKnowledgeEntry({
      issueSummary: "x",
      structured: {
        conversation_summary: "summary",
        custom_field: { nested: true },
      },
    });
    const stored = await getKnowledgeEntry(row.id);
    expect(stored.structured.conversation_summary).toBe("summary");
    expect(stored.structured.custom_field).toEqual({ nested: true });
  });
});
