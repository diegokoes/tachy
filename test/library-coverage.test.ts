import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  coverage,
  saveKnowledgeEntry,
  saveReferenceDoc,
  recordView,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

const find = (nodes: any[], slug: string): any => {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const hit = find(n.children, slug);
    if (hit) return hit;
  }
  return null;
};

describe("wiki coverage", () => {
  beforeEach(resetData);

  const tree = async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "portal", name: "Portal" });
    await addComponent({
      productId,
      slug: "printing",
      name: "Printing",
      parentSlug: "portal",
    });
    await addComponent({ productId, slug: "coding", name: "Coding" });
    return productId;
  };

  it("counts entries, docs and articles per component", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "spooler stalls",
    });
    await saveReferenceDoc({
      productId,
      component: "printing",
      title: "runbook",
      body: "b",
    });
    await saveReferenceDoc({
      productId,
      component: "printing",
      kind: "wiki",
      slug: "printing-guide",
      title: "Printing guide",
      body: "b",
    });

    const c = await coverage(productId);
    const printing = find(c.nodes, "printing");
    expect(printing).toMatchObject({ entries: 1, docs: 1, articles: 1 });
  });

  it("rolls a subtree up into its parent, counting each item once", async () => {
    const productId = await tree();
    for (const summary of ["a", "b", "c"])
      await saveKnowledgeEntry({
        productId,
        component: "printing",
        issueSummary: summary,
      });
    await saveKnowledgeEntry({
      productId,
      component: "portal",
      issueSummary: "d",
    });

    const c = await coverage(productId);
    const portal = find(c.nodes, "portal");
    expect(portal.entries).toBe(1);
    expect(portal.subtree.entries).toBe(4);
    expect(find(c.nodes, "printing").subtree.entries).toBe(3);
    expect(find(c.nodes, "coding").subtree.entries).toBe(0);
  });

  it("nests the tree the way components nest", async () => {
    const productId = await tree();
    const c = await coverage(productId);
    expect(c.nodes.map((n: any) => n.slug).sort()).toEqual([
      "coding",
      "portal",
    ]);
    expect(find(c.nodes, "portal").children.map((n: any) => n.slug)).toEqual([
      "printing",
    ]);
  });

  /** The signal the view exists for: lessons recorded, nothing written. */
  it("shows a component with entries and no article", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "coding",
      issueSummary: "x",
    });
    const c = await coverage(productId);
    const coding = find(c.nodes, "coding");
    expect(coding.entries).toBe(1);
    expect(coding.articles).toBe(0);
  });

  it("collects what is filed under no component at all", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({ productId, issueSummary: "unfiled entry" });
    await saveReferenceDoc({ productId, title: "unfiled doc", body: "b" });
    await saveKnowledgeEntry({
      productId,
      component: "coding",
      issueSummary: "filed",
    });

    const c = await coverage(productId);
    expect(c.unfiled).toMatchObject({ entries: 1, docs: 1, articles: 0 });
  });

  it("attributes read volume to the component the item is anchored to", async () => {
    const productId = await tree();
    const e = await saveKnowledgeEntry({
      productId,
      component: "printing",
      issueSummary: "spooler",
    });
    await recordView({ entryId: e.id }, null);

    const c = await coverage(productId);
    expect(find(c.nodes, "printing").reads).toBe(1);
    expect(find(c.nodes, "portal").reads).toBe(0);
    expect(find(c.nodes, "portal").subtree.reads).toBe(1);
  });

  it("ignores archived items", async () => {
    const productId = await tree();
    await saveKnowledgeEntry({
      productId,
      component: "coding",
      issueSummary: "gone",
      status: "archived",
    });
    expect(find((await coverage(productId)).nodes, "coding").entries).toBe(0);
  });

  it("is empty but well-formed for a product with no components", async () => {
    const productId = await tpdProductId();
    const c = await coverage(productId);
    expect(c.nodes).toEqual([]);
    expect(c.unfiled).toMatchObject({ entries: 0, docs: 0, articles: 0 });
  });
});
