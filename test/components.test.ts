import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  listComponents,
  addComponent,
  saveKnowledgeEntry,
  componentRenameImpact,
  renameComponent,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

describe("components", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("builds a hierarchy: a parent and its nested children", async () => {
    const tpd = await tpdProductId();
    await addComponent({
      productId: tpd,
      slug: "business-object",
      name: "Business Object",
    });
    await addComponent({
      productId: tpd,
      slug: "business-object-id-issuer",
      name: "ID Issuer",
      parentSlug: "business-object",
    });

    const rows = await listComponents(tpd);
    const idIssuer = rows.find((r) => r.slug === "business-object-id-issuer");
    const parent = rows.find((r) => r.slug === "business-object");
    expect(idIssuer?.parent_id).toBe(parent?.id);
  });

  it("scopes components per product", async () => {
    const tpd = await tpdProductId();
    const [ftrace] = await sql`select id from products where slug = 'ftrace'`;
    await addComponent({
      productId: tpd,
      slug: "line-controller",
      name: "Line Controller",
    });

    expect(await listComponents(tpd)).toHaveLength(1);
    expect(await listComponents(ftrace.id)).toHaveLength(0);
  });

  it("rejects an unknown parent slug", async () => {
    const tpd = await tpdProductId();
    await expect(
      addComponent({
        productId: tpd,
        slug: "x",
        name: "X",
        parentSlug: "does-not-exist",
      }),
    ).rejects.toThrow(/Unknown parent component/);
  });

  it("upserts on (product_id, slug) instead of duplicating", async () => {
    const tpd = await tpdProductId();
    await addComponent({
      productId: tpd,
      slug: "line-controller",
      name: "Line Controller",
    });
    await addComponent({
      productId: tpd,
      slug: "line-controller",
      name: "Line Controller Service",
    });
    const rows = await listComponents(tpd);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Line Controller Service");
  });

  it("renames a slug and rewrites it where it tagged this product's entries", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "lc", name: "Line Controller" });
    const tagged = await saveKnowledgeEntry({
      productId: tpd,
      issueSummary: "x",
      tags: ["lc", "printing"],
      status: "approved",
    });
    const untagged = await saveKnowledgeEntry({
      productId: tpd,
      issueSummary: "y",
      tags: ["printing"],
      status: "approved",
    });

    expect(await componentRenameImpact(tpd, "lc")).toEqual({
      entries: 1,
      docs: 0,
    });

    const res = await renameComponent(tpd, "lc", "line-controller");
    expect(res).toMatchObject({
      renamed: true,
      from: "lc",
      to: "line-controller",
      entries: 1,
    });

    expect((await listComponents(tpd)).map((c) => c.slug)).toEqual([
      "line-controller",
    ]);
    const [t] =
      await sql`select tags from knowledge_entries where id = ${tagged.id}`;
    expect(t.tags).toEqual(["line-controller", "printing"]);
    const [u] =
      await sql`select tags from knowledge_entries where id = ${untagged.id}`;
    expect(u.tags).toEqual(["printing"]);
  });

  it("refuses to rename onto an existing component slug in the same product", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "a", name: "A" });
    await addComponent({ productId: tpd, slug: "b", name: "B" });
    await expect(renameComponent(tpd, "a", "b")).rejects.toThrow(
      /already exists/,
    );
  });
});
