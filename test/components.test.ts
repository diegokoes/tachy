import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listComponents, addComponent } from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

describe("components", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("builds a hierarchy: a parent and its nested children", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "business-object", name: "Business Object" });
    await addComponent({
      productId: tpd, slug: "business-object-id-issuer", name: "ID Issuer",
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
    await addComponent({ productId: tpd, slug: "line-controller", name: "Line Controller" });

    expect(await listComponents(tpd)).toHaveLength(1);
    expect(await listComponents(ftrace.id)).toHaveLength(0);
  });

  it("rejects an unknown parent slug", async () => {
    const tpd = await tpdProductId();
    await expect(addComponent({ productId: tpd, slug: "x", name: "X", parentSlug: "does-not-exist" }))
      .rejects.toThrow(/Unknown parent component/);
  });

  it("upserts on (product_id, slug) instead of duplicating", async () => {
    const tpd = await tpdProductId();
    await addComponent({ productId: tpd, slug: "line-controller", name: "Line Controller" });
    await addComponent({ productId: tpd, slug: "line-controller", name: "Line Controller Service" });
    const rows = await listComponents(tpd);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Line Controller Service");
  });
});
