import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  listResolutionPatterns,
  addResolutionPattern,
  renameResolutionPattern,
  resolutionPatternRenameImpact,
} from "@tachy/core";
import { resetData, sql } from "./helpers";

describe("resolution_patterns", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("starts empty, and a seeded pattern is returned by list", async () => {
    expect(await listResolutionPatterns()).toEqual([]);
    await addResolutionPattern(
      "config-mismatch",
      "A configured value doesn't match what another component expects",
    );
    const rows = await listResolutionPatterns();
    expect(rows).toEqual([
      {
        slug: "config-mismatch",
        description:
          "A configured value doesn't match what another component expects",
      },
    ]);
  });

  it("rejects an unknown resolution_pattern with a clear error, not a raw FK violation", async () => {
    await expect(
      saveKnowledgeEntry({
        issueSummary: "x",
        resolutionPattern: "made-up-slug",
      }),
    ).rejects.toThrow(
      /Unknown resolution_pattern 'made-up-slug'.*list_resolution_patterns/,
    );
  });

  it("accepts a seeded slug", async () => {
    await addResolutionPattern("config-mismatch", "desc");
    const row = await saveKnowledgeEntry({
      issueSummary: "x",
      resolutionPattern: "config-mismatch",
      status: "approved",
    });
    const [stored] =
      await sql`select resolution_pattern from knowledge_entries where id = ${row.id}`;
    expect(stored.resolution_pattern).toBe("config-mismatch");
  });

  it("leaves resolution_pattern null when omitted, never invents one", async () => {
    const row = await saveKnowledgeEntry({ issueSummary: "x" });
    const [stored] =
      await sql`select resolution_pattern from knowledge_entries where id = ${row.id}`;
    expect(stored.resolution_pattern).toBeNull();
  });

  it("renaming a pattern slug cascades to referencing entries and reports the count", async () => {
    await addResolutionPattern("config-mismatch", "desc");
    const a = await saveKnowledgeEntry({
      issueSummary: "a",
      resolutionPattern: "config-mismatch",
      status: "approved",
    });
    const b = await saveKnowledgeEntry({
      issueSummary: "b",
      resolutionPattern: "config-mismatch",
      status: "approved",
    });

    expect(await resolutionPatternRenameImpact("config-mismatch")).toEqual({
      entries: 2,
    });

    const res = await renameResolutionPattern(
      "config-mismatch",
      "config-drift",
    );
    expect(res).toMatchObject({
      renamed: true,
      from: "config-mismatch",
      to: "config-drift",
      entries: 2,
    });

    expect((await listResolutionPatterns()).map((p) => p.slug)).toEqual([
      "config-drift",
    ]);
    const rows =
      await sql`select resolution_pattern from knowledge_entries where id in ${sql([a.id, b.id])}`;
    expect(rows.every((r) => r.resolution_pattern === "config-drift")).toBe(
      true,
    );
  });

  it("refuses to rename onto an existing pattern slug", async () => {
    await addResolutionPattern("one", "d");
    await addResolutionPattern("two", "d");
    await expect(renameResolutionPattern("one", "two")).rejects.toThrow(
      /already exists/,
    );
  });
});
