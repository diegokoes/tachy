import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addProduct, getProductIdBySlug, addComponent, resolveComponentTags, resolveComponentStrict,
  listLabels, addLabel, saveKnowledgeEntry, searchKnowledge, updateKnowledgeEntry, getKnowledgeEntry,
} from "@tachy/core";
import { resetData, sql, tqxProductId } from "./helpers";

afterAll(() => sql.end());

describe("taxonomy", () => {
  beforeEach(resetData);

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

describe("component-anchored knowledge entries", () => {
  beforeEach(resetData);

  async function seedHierarchy() {
    const tqx = await tqxProductId();
    await addComponent({ productId: tqx, slug: "printing", name: "Printing" });
    await addComponent({
      productId: tqx, slug: "line-controller", name: "Line Controller",
      parentSlug: "printing", aliases: ["lc", "LC"],
    });
    return tqx;
  }

  it("resolves strictly by slug or alias and derives the hierarchy path", async () => {
    const tqx = await seedHierarchy();
    const bySlug = await resolveComponentStrict(tqx, "line-controller");
    const byAlias = await resolveComponentStrict(tqx, "lc");
    expect(byAlias.id).toBe(bySlug.id);
    expect(bySlug.path).toBe("Test Product / Printing / Line Controller");
  });

  it("rejects an unknown component with nearest-match suggestions", async () => {
    const tqx = await seedHierarchy();
    await expect(resolveComponentStrict(tqx, "line-contorller")).rejects.toThrow(/line-controller/);
    await expect(resolveComponentStrict(tqx, "line-contorller")).rejects.toThrow(/add_component/);
  });

  it("save links the component FK and derives product_area; unknown values are rejected", async () => {
    const tqx = await seedHierarchy();
    const row = await saveKnowledgeEntry({
      status: "approved", productId: tqx, issueSummary: "print head jam", component: "lc",
    });
    const stored = await getKnowledgeEntry(row.id);
    expect(stored.component_id).not.toBeNull();
    expect(stored.product_area).toBe("Test Product / Printing / Line Controller");

    await expect(
      saveKnowledgeEntry({ productId: tqx, issueSummary: "x", component: "made-up" }),
    ).rejects.toThrow(/Unknown component/);
    await expect(
      saveKnowledgeEntry({ issueSummary: "x", component: "lc" }), // no product to resolve against
    ).rejects.toThrow(/requires a product/);
  });

  it("update re-derives product_area from a new component and null clears both", async () => {
    const tqx = await seedHierarchy();
    const row = await saveKnowledgeEntry({ status: "approved", productId: tqx, issueSummary: "x", component: "printing" });

    await updateKnowledgeEntry(row.id, { component: "lc" });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.product_area).toBe("Test Product / Printing / Line Controller");

    await updateKnowledgeEntry(row.id, { component: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.component_id).toBeNull();
    expect(stored.product_area).toBeNull();
  });

  it("componentId search filter catches FK-linked AND legacy tag-only entries", async () => {
    const tqx = await seedHierarchy();
    const { id: componentId } = await resolveComponentStrict(tqx, "lc");
    await saveKnowledgeEntry({ status: "approved", productId: tqx, issueSummary: "printer jams on batch", component: "lc" });
    await saveKnowledgeEntry({ status: "approved", productId: tqx, issueSummary: "printer jams on batch", tags: ["lc"] });
    await saveKnowledgeEntry({ status: "approved", productId: tqx, issueSummary: "printer jams on batch", tags: ["network"] });

    const rows = await searchKnowledge("printer jams", {
      productId: tqx, componentId, componentTags: ["line-controller", "lc", "LC"],
    });
    expect(rows).toHaveLength(2);
  });

  it("makes the derived product_area path full-text searchable", async () => {
    const tqx = await seedHierarchy();
    await saveKnowledgeEntry({ status: "approved", productId: tqx, issueSummary: "intermittent timeout", component: "lc" });
    const rows = await searchKnowledge("Line Controller");
    expect(rows[0].issue_summary).toBe("intermittent timeout");
  });
});
