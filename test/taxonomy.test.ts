import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addProduct, getProductIdBySlug, addComponent, resolveComponentTags, resolveComponentStrict,
  listLabels, addLabel, saveKnowledgeEntry, searchKnowledge, updateKnowledgeEntry, getKnowledgeEntry,
  updateComponent, deleteComponent, updateProduct, deleteProduct, addTeam, deleteTeam,
  updateLabel, deleteLabel, addResolutionPattern, deleteResolutionPattern,
  updateCustomer, deleteCustomer, addCustomer,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

describe("taxonomy", () => {
  beforeEach(resetData);

  it("resolves a product by an alias, case-insensitively", async () => {
    await addProduct("test-team", "tpd", "Test Product", ["Tobacco Product Directive", "TPD"]);
    const byAlias = await getProductIdBySlug("tobacco product directive");
    const bySlug = await getProductIdBySlug("tpd");
    expect(byAlias).toBe(bySlug);
  });

  it("expands a component slug/alias into its tag set for filtering", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "line-controller", name: "Line Controller", aliases: ["lc", "LC"] });
    const fromAlias = await resolveComponentTags(tpd, "lc");
    expect(fromAlias).toContain("line-controller");
    
    expect(await resolveComponentTags(tpd, "mystery")).toEqual(["mystery"]);
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
    const tpd = await tpdProductId();
    await addLabel(tpd, "lc", "Line Controller");
    await addLabel(tpd, "lc", "Line Controller subsystem");
    const labels = await listLabels(tpd);
    expect(labels).toHaveLength(1);
    expect(labels[0].description).toBe("Line Controller subsystem");
  });
});

describe("component-anchored knowledge entries", () => {
  beforeEach(resetData);

  async function seedHierarchy() {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "printing", name: "Printing" });
    await addComponent({
      productId: tpd, slug: "line-controller", name: "Line Controller",
      parentSlug: "printing", aliases: ["lc", "LC"],
    });
    return tpd;
  }

  it("resolves strictly by slug or alias and derives the hierarchy path", async () => {
    const tpd = await seedHierarchy();
    const bySlug = await resolveComponentStrict(tpd, "line-controller");
    const byAlias = await resolveComponentStrict(tpd, "lc");
    expect(byAlias.id).toBe(bySlug.id);
    expect(bySlug.path).toBe("Test Product / Printing / Line Controller");
  });

  it("rejects an unknown component with nearest-match suggestions", async () => {
    const tpd = await seedHierarchy();
    await expect(resolveComponentStrict(tpd, "line-contorller")).rejects.toThrow(/line-controller/);
    await expect(resolveComponentStrict(tpd, "line-contorller")).rejects.toThrow(/add_component/);
  });

  it("save links the component FK and derives product_area; unknown values are rejected", async () => {
    const tpd = await seedHierarchy();
    const row = await saveKnowledgeEntry({
      status: "approved", productId: tpd, issueSummary: "print head jam", component: "lc",
    });
    const stored = await getKnowledgeEntry(row.id);
    expect(stored.component_id).not.toBeNull();
    expect(stored.product_area).toBe("Test Product / Printing / Line Controller");

    await expect(
      saveKnowledgeEntry({ productId: tpd, issueSummary: "x", component: "made-up" }),
    ).rejects.toThrow(/Unknown component/);
    await expect(
      saveKnowledgeEntry({ issueSummary: "x", component: "lc" }), 
    ).rejects.toThrow(/requires a product/);
  });

  it("update re-derives product_area from a new component and null clears both", async () => {
    const tpd = await seedHierarchy();
    const row = await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "x", component: "printing" });

    await updateKnowledgeEntry(row.id, { component: "lc" });
    let stored = await getKnowledgeEntry(row.id);
    expect(stored.product_area).toBe("Test Product / Printing / Line Controller");

    await updateKnowledgeEntry(row.id, { component: null });
    stored = await getKnowledgeEntry(row.id);
    expect(stored.component_id).toBeNull();
    expect(stored.product_area).toBeNull();
  });

  it("componentId search filter catches FK-linked AND legacy tag-only entries", async () => {
    const tpd = await seedHierarchy();
    const { id: componentId } = await resolveComponentStrict(tpd, "lc");
    await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "printer jams on batch", component: "lc" });
    await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "printer jams on batch", tags: ["lc"] });
    await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "printer jams on batch", tags: ["network"] });

    const rows = await searchKnowledge("printer jams", {
      productId: tpd, componentId, componentTags: ["line-controller", "lc", "LC"],
    });
    expect(rows).toHaveLength(2);
  });

  it("makes the derived product_area path full-text searchable", async () => {
    const tpd = await seedHierarchy();
    await saveKnowledgeEntry({ status: "approved", productId: tpd, issueSummary: "intermittent timeout", component: "lc" });
    const rows = await searchKnowledge("Line Controller");
    expect(rows[0].issue_summary).toBe("intermittent timeout");
  });
});

describe("taxonomy edit/delete with reference guards", () => {
  beforeEach(resetData);

  it("updates a component in place and refuses to delete it while referenced", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "lc", name: "LC" });
    await addComponent({ productId: tpd, slug: "printer", name: "Printer", parentSlug: "lc" });

    const updated = await updateComponent(tpd, "lc", { name: "Line Controller", aliases: ["LC"] });
    expect(updated.name).toBe("Line Controller");

    
    await expect(deleteComponent(tpd, "lc")).rejects.toMatchObject({ code: "conflict" });
    await deleteComponent(tpd, "printer");

    
    await saveKnowledgeEntry({ productId: tpd, issueSummary: "x", component: "lc" });
    await expect(deleteComponent(tpd, "lc")).rejects.toThrow(/knowledge entr/);
  });

  it("customer edit/delete: partial update, delete guarded by work items", async () => {
    await addCustomer({ name: "ACME", slug: "acme", aliases: ["acme.com"] });
    const updated = await updateCustomer("acme", { notes: "flagship" });
    expect(updated.notes).toBe("flagship");
    expect(updated.name).toBe("ACME"); 

    const [conn] = await sql`select id from source_connections where slug = 'test-freshdesk'`;
    const [cust] = await sql`select id from customers where slug = 'acme'`;
    await sql`
      insert into work_items (source_connection_id, external_id, title, customer_id)
      values (${conn.id}, 'c-1', 't', ${cust.id})
    `;
    await expect(deleteCustomer("acme")).rejects.toMatchObject({ code: "conflict" });
    await sql`update work_items set customer_id = null where external_id = 'c-1'`;
    await deleteCustomer("acme");
  });

  it("team/product deletes are guarded; empty ones go away", async () => {
    await addTeam("temp", "Temp Team");
    const prod = await addProduct("temp", "widget", "Widget");
    await expect(deleteTeam("temp")).rejects.toMatchObject({ code: "conflict" });

    await saveKnowledgeEntry({ productId: prod.id as string, issueSummary: "y" });
    await expect(deleteProduct(prod.id as string)).rejects.toThrow(/knowledge entr/);
    await sql`delete from knowledge_entries where product_id = ${prod.id}`;

    const renamed = await updateProduct(prod.id as string, { name: "Widget 2" });
    expect(renamed.name).toBe("Widget 2");
    await deleteProduct(prod.id as string);
    await deleteTeam("temp");
  });

  it("labels and resolution patterns: update, guarded pattern delete", async () => {
    const tpd = await tpdProductId();
    await addLabel(tpd, "printing", "print issues");
    expect((await updateLabel(tpd, "printing", null)).description).toBeNull();
    await deleteLabel(tpd, "printing");

    await addResolutionPattern("config-fix", "fix the config");
    await saveKnowledgeEntry({ issueSummary: "z", resolutionPattern: "config-fix" });
    await expect(deleteResolutionPattern("config-fix")).rejects.toMatchObject({ code: "conflict" });
    await sql`update knowledge_entries set resolution_pattern = null`;
    await deleteResolutionPattern("config-fix");
  });
});
