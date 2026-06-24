import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addProduct, getProductIdBySlug, addComponent, resolveComponentTags,
  listLabels, addLabel, saveKnowledgeEntry, searchKnowledge,
} from "@tachy/core";
import { resetData, sql, tqxProductId } from "./helpers";

describe("taxonomy", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("resolves a product by an alias, case-insensitively", async () => {
    await addProduct("test-team", "tqx", "Test Product", ["Trade Quota Exchange", "TQX"]);
    const byAlias = await getProductIdBySlug("trade quota exchange");
    const bySlug = await getProductIdBySlug("tqx");
    expect(byAlias).toBe(bySlug);
  });

  it("expands a component slug/alias into its tag set for filtering", async () => {
    const tqx = await tqxProductId();
    await addComponent({ productId: tqx, slug: "line-controller", name: "Line Controller", aliases: ["lc", "LC"] });
    const fromAlias = await resolveComponentTags(tqx, "lc");
    expect(fromAlias).toContain("line-controller");
    // Unknown input falls back to itself so it still works as a plain tag.
    expect(await resolveComponentTags(tqx, "mystery")).toEqual(["mystery"]);
  });

  it("filters search by tag overlap", async () => {
    await saveKnowledgeEntry({ status: "approved", issueSummary: "printer jams on label batch", tags: ["printing", "lc"] });
    await saveKnowledgeEntry({ status: "approved", issueSummary: "printer jams on label batch", tags: ["network"] });

    const onlyLc = await searchKnowledge("printer jams", { tags: ["lc"] });
    expect(onlyLc).toHaveLength(1);
    expect(onlyLc[0].tags).toContain("lc");
  });

  it("makes tags full-text searchable via the generated search column", async () => {
    await saveKnowledgeEntry({ status: "approved", issueSummary: "intermittent timeout", tags: ["manual-aggregation-station"] });
    const rows = await searchKnowledge("manual-aggregation-station");
    expect(rows[0].issue_summary).toBe("intermittent timeout");
  });

  it("curates an advisory label vocabulary per product (upsert, not enforced)", async () => {
    const tqx = await tqxProductId();
    await addLabel(tqx, "lc", "Line Controller");
    await addLabel(tqx, "lc", "Line Controller subsystem");
    const labels = await listLabels(tqx);
    expect(labels).toHaveLength(1);
    expect(labels[0].description).toBe("Line Controller subsystem");
  });
});
