import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  listComponents,
  addComponent,
  saveKnowledgeEntry,
  componentRenameImpact,
  renameComponent,
  updateComponent,
} from "@tachy/core";
import { resetData, sql, tqxProductId } from "./helpers";

describe("components", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("builds a hierarchy: a parent and its nested children", async () => {
    const tqx = await tqxProductId();
    await addComponent({
      productId: tqx,
      slug: "business-object",
      name: "Business Object",
    });
    await addComponent({
      productId: tqx,
      slug: "business-object-id-issuer",
      name: "ID Issuer",
      parentSlug: "business-object",
    });

    const rows = await listComponents(tqx);
    const idIssuer = rows.find((r) => r.slug === "business-object-id-issuer");
    const parent = rows.find((r) => r.slug === "business-object");
    expect(idIssuer?.parent_id).toBe(parent?.id);
  });

  it("scopes components per product", async () => {
    const tqx = await tqxProductId();
    const [fqlink] = await sql`select id from products where slug = 'fqlink'`;
    await addComponent({
      productId: tqx,
      slug: "line-controller",
      name: "Line Controller",
    });

    expect(await listComponents(tqx)).toHaveLength(1);
    expect(await listComponents(fqlink.id)).toHaveLength(0);
  });

  it("refuses a re-parent that would close a cycle", async () => {
    const tqx = await tqxProductId();
    await addComponent({ productId: tqx, slug: "a", name: "A" });
    await addComponent({
      productId: tqx,
      slug: "b",
      name: "B",
      parentSlug: "a",
    });
    await addComponent({
      productId: tqx,
      slug: "c",
      name: "C",
      parentSlug: "b",
    });

    await expect(
      updateComponent(tqx, "a", { parentSlug: "c" }),
    ).rejects.toThrow(/cycle/);
    await expect(
      updateComponent(tqx, "a", { parentSlug: "a" }),
    ).rejects.toThrow(/its own parent/);

    // A move that does not close a ring still goes through.
    const moved = await updateComponent(tqx, "c", { parentSlug: "a" });
    expect(moved.slug).toBe("c");
  });

  it("rejects an unknown parent slug", async () => {
    const tqx = await tqxProductId();
    await expect(
      addComponent({
        productId: tqx,
        slug: "x",
        name: "X",
        parentSlug: "does-not-exist",
      }),
    ).rejects.toThrow(/Unknown parent component/);
  });

  it("upserts on (product_id, slug) instead of duplicating", async () => {
    const tqx = await tqxProductId();
    await addComponent({
      productId: tqx,
      slug: "line-controller",
      name: "Line Controller",
    });
    await addComponent({
      productId: tqx,
      slug: "line-controller",
      name: "Line Controller Service",
    });
    const rows = await listComponents(tqx);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Line Controller Service");
  });

  it("renames a slug and rewrites it where it tagged this product's entries", async () => {
    const tqx = await tqxProductId();
    await addComponent({ productId: tqx, slug: "lc", name: "Line Controller" });
    const tagged = await saveKnowledgeEntry({
      productId: tqx,
      issueSummary: "x",
      tags: ["lc", "printing"],
      status: "approved",
    });
    const untagged = await saveKnowledgeEntry({
      productId: tqx,
      issueSummary: "y",
      tags: ["printing"],
      status: "approved",
    });

    expect(await componentRenameImpact(tqx, "lc")).toEqual({
      entries: 1,
      docs: 0,
    });

    const res = await renameComponent(tqx, "lc", "line-controller");
    expect(res).toMatchObject({
      renamed: true,
      from: "lc",
      to: "line-controller",
      entries: 1,
    });

    expect((await listComponents(tqx)).map((c) => c.slug)).toEqual([
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
    const tqx = await tqxProductId();
    await addComponent({ productId: tqx, slug: "a", name: "A" });
    await addComponent({ productId: tqx, slug: "b", name: "B" });
    await expect(renameComponent(tqx, "a", "b")).rejects.toThrow(
      /already exists/,
    );
  });
});
