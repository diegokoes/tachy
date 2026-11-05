import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  addCustomerUnit,
  addUnitKind,
  deleteUnitKind,
  deleteUnitKindFact,
  getCustomerIdBySlug,
  getProductBlueprint,
  getProductIdBySlug,
  listCustomerUnits,
  setCustomerFact,
  setUnitKindFact,
  updateCustomerUnit,
  updateUnitKind,
  updateUnitKindFact,
} from "@tachy/core/catalog";
import { resetData, sql, tqxProductId } from "../database";

afterAll(() => sql.end());

/** Trellis's shape: sites hold lines, and lines follow a layout. */
async function trellisBlueprint(productId: string) {
  await addUnitKind({ productId, slug: "site", name: "Site" });
  await addUnitKind({
    productId,
    slug: "layout",
    name: "Line layout",
    facts: [{ kind: "printers" }],
  });
  await addUnitKind({
    productId,
    slug: "line",
    name: "Production line",
    parentKind: "site",
    templateKind: "layout",
    facts: [
      { kind: "ip", description: "one address per device, by label" },
      { kind: "coding_mode", choices: ["CT1", "CT2", "CT3"] },
    ],
  });
}

async function customerWithSetup() {
  const productId = await tqxProductId();
  await trellisBlueprint(productId);
  await addCustomer({ name: "Ilverton Brands", slug: "ivk" });
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "calderra",
    name: "Calderra",
    kind: "site",
    productId,
  });
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "layout-3",
    name: "Layout 3",
    kind: "layout",
    productId,
  });
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "pln191",
    name: "PLN191",
    kind: "line",
    productId,
    parentSlug: "calderra",
    templateSlug: "layout-3",
  });
  return { productId, customerId: await getCustomerIdBySlug("ivk") };
}

describe("a product's blueprint", () => {
  beforeEach(resetData);

  it("reads back kinds with where they sit, their template and their facts", async () => {
    await trellisBlueprint(await tqxProductId());
    const blueprint = await getProductBlueprint(await tqxProductId());
    expect(blueprint.product_slug).toBe("tqx");
    const line = blueprint.kinds.find((k) => k.slug === "line")!;
    expect(line).toMatchObject({
      parent_kind: "site",
      template_kind: "layout",
    });
    expect(line.facts.map((f) => f.kind).sort()).toEqual(["coding_mode", "ip"]);
    expect(line.facts.find((f) => f.kind === "coding_mode")!.choices).toEqual([
      "CT1",
      "CT2",
      "CT3",
    ]);
  });

  it("has no kinds for a product nobody has described", async () => {
    expect((await getProductBlueprint(await tqxProductId())).kinds).toEqual([]);
  });

  it("keeps a kind's edges when it is added again with only new facts", async () => {
    const productId = await tqxProductId();
    await trellisBlueprint(productId);
    await addUnitKind({
      productId,
      slug: "line",
      name: "Production line",
      facts: [{ kind: "printer_model" }],
    });
    const line = (await getProductBlueprint(productId)).kinds.find(
      (k) => k.slug === "line",
    )!;
    expect(line.parent_kind).toBe("site");
    expect(line.template_kind).toBe("layout");
    expect(line.facts.map((f) => f.kind).sort()).toEqual([
      "coding_mode",
      "ip",
      "printer_model",
    ]);
  });

  it("trims choices and drops blank and repeated ones", async () => {
    const productId = await tqxProductId();
    await trellisBlueprint(productId);
    await setUnitKindFact(productId, "line", {
      kind: "speed",
      choices: [" slow ", "", "fast", "FAST"],
    });
    const speed = (await getProductBlueprint(productId)).kinds
      .find((k) => k.slug === "line")!
      .facts.find((f) => f.kind === "speed")!;
    expect(speed.choices).toEqual(["slow", "fast"]);
  });

  it("refuses a kind slug a flow or binding could not name", async () => {
    await expect(
      addUnitKind({
        productId: await tqxProductId(),
        slug: "Production Line",
        name: "Line",
      }),
    ).rejects.toThrow(/lowercase/);
  });

  it("refuses a parent kind that would make the kinds a ring", async () => {
    const productId = await tqxProductId();
    await trellisBlueprint(productId);
    await expect(
      updateUnitKind(productId, "site", { parentKind: "line" }),
    ).rejects.toThrow(/already sits inside/);
    await expect(
      updateUnitKind(productId, "site", { parentKind: "site" }),
    ).rejects.toThrow(/itself/);
  });

  it("takes its units along when a kind is renamed", async () => {
    const { productId, customerId } = await customerWithSetup();
    await updateUnitKind(productId, "line", { slug: "production-line" });
    const units = await listCustomerUnits(customerId);
    expect(units.find((u) => u.slug === "pln191")!.kind).toBe(
      "production-line",
    );
  });

  it("refuses to delete a kind that units have or other kinds depend on", async () => {
    const { productId } = await customerWithSetup();
    await expect(deleteUnitKind(productId, "line")).rejects.toThrow(
      /1 unit\(s\) are 'line'/,
    );
    await sql`delete from customer_units`;
    await expect(deleteUnitKind(productId, "site")).rejects.toThrow(
      /'line' sit inside or follow 'site'/,
    );
    await expect(deleteUnitKind(productId, "line")).resolves.toMatchObject({
      deleted: true,
    });
  });

  it("refuses to delete or rename a fact kind that units record", async () => {
    const { productId } = await customerWithSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "pln191",
      kind: "ip",
      label: "plc",
      value: "10.4.12.31",
    });
    await expect(deleteUnitKindFact(productId, "line", "ip")).rejects.toThrow(
      /delete or change them first/,
    );
    await expect(
      updateUnitKindFact(productId, "line", "ip", { kind: "address" }),
    ).rejects.toThrow(/keeps its name/);
    await expect(
      updateUnitKindFact(productId, "line", "coding_mode", {
        kind: "coding",
        description: "how codes are applied",
      }),
    ).resolves.toMatchObject({ kind: "coding" });
    await expect(
      deleteUnitKindFact(productId, "line", "coding"),
    ).resolves.toMatchObject({ deleted: true });
  });
});

describe("units against the blueprint", () => {
  beforeEach(resetData);

  it("accepts a setup that follows the blueprint", async () => {
    const { customerId } = await customerWithSetup();
    const line = (await listCustomerUnits(customerId)).find(
      (u) => u.slug === "pln191",
    )!;
    expect(line.product_slug).toBe("tqx");
  });

  it("refuses a kind the blueprint does not list, naming the ones it does", async () => {
    const productId = await tqxProductId();
    await trellisBlueprint(productId);
    await addCustomer({ name: "Ilverton Brands", slug: "ivk" });
    await expect(
      addCustomerUnit({
        customerSlug: "ivk",
        slug: "hall-a",
        name: "Hall A",
        kind: "hall",
        productId,
      }),
    ).rejects.toThrow(/'hall' is not a unit kind.*'layout', 'line', 'site'/);
  });

  it("refuses a unit inside the wrong kind, and a parent at the top", async () => {
    const { productId } = await customerWithSetup();
    await expect(
      addCustomerUnit({
        customerSlug: "ivk",
        slug: "pln192",
        name: "PLN192",
        kind: "line",
        productId,
        parentSlug: "layout-3",
      }),
    ).rejects.toThrow(/a line sits inside a site; 'layout-3' is a layout/);
    await expect(
      addCustomerUnit({
        customerSlug: "ivk",
        slug: "logrono",
        name: "Logrono",
        kind: "site",
        productId,
        parentSlug: "calderra",
      }),
    ).rejects.toThrow(/a site sits inside no unit/);
  });

  it("puts a line at the top of the setup when it has no site", async () => {
    const { productId, customerId } = await customerWithSetup();
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "tpc141",
      name: "TPC141",
      kind: "line",
      productId,
    });
    const units = await listCustomerUnits(customerId);
    expect(units.find((u) => u.slug === "tpc141")!.parent_id).toBeNull();
  });

  it("refuses a template of the wrong kind", async () => {
    const { productId } = await customerWithSetup();
    await expect(
      addCustomerUnit({
        customerSlug: "ivk",
        slug: "pln192",
        name: "PLN192",
        kind: "line",
        productId,
        templateSlug: "calderra",
      }),
    ).rejects.toThrow(/a line follows a layout; 'calderra' is a site/);
  });

  it("refuses a parent from another product's setup", async () => {
    const { productId } = await customerWithSetup();
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "old-site",
      name: "Old site",
      kind: "site",
    });
    await expect(
      addCustomerUnit({
        customerSlug: "ivk",
        slug: "pln193",
        name: "PLN193",
        kind: "line",
        productId,
        parentSlug: "old-site",
      }),
    ).rejects.toThrow(/belongs to another product's setup/);
  });

  it("checks a unit again when it is moved into a product", async () => {
    const { productId, customerId } = await customerWithSetup();
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "warehouse",
      name: "Warehouse",
      kind: "warehouse",
    });
    await expect(
      updateCustomerUnit(customerId, "warehouse", { productId }),
    ).rejects.toThrow(/'warehouse' is not a unit kind/);
    await updateCustomerUnit(customerId, "warehouse", {
      productId,
      kind: "site",
    });
  });

  it("leaves general units and products without a blueprint free form", async () => {
    await customerWithSetup();
    const fqlink = await getProductIdBySlug("fqlink");
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "anything",
      name: "Anything",
      kind: "whatever",
    });
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "fleet",
      name: "Fleet",
      kind: "depot",
      productId: fqlink,
    });
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "fleet",
      kind: "anything_goes",
      value: "yes",
    });
  });
});

describe("facts against the blueprint", () => {
  beforeEach(resetData);

  it("refuses a fact the unit's kind does not record, naming the ones it does", async () => {
    await customerWithSetup();
    await expect(
      setCustomerFact({
        customerSlug: "ivk",
        unit: "pln191",
        kind: "timezone",
        value: "Europe/Madrid",
      }),
    ).rejects.toThrow(
      /'timezone' is not a fact of a line.*'coding_mode', 'ip'/,
    );
  });

  it("stores the choice's own spelling, and refuses a value outside the choices", async () => {
    await customerWithSetup();
    const stored = await setCustomerFact({
      customerSlug: "ivk",
      unit: "pln191",
      kind: "coding_mode",
      value: "ct2",
    });
    expect(stored.value).toBe("CT2");
    await expect(
      setCustomerFact({
        customerSlug: "ivk",
        unit: "pln191",
        kind: "coding_mode",
        value: "CT9",
      }),
    ).rejects.toThrow(/one of 'CT1', 'CT2', 'CT3'/);
  });

  it("lets a template record the facts of the kinds that follow it", async () => {
    await customerWithSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "layout-3",
      kind: "coding_mode",
      value: "CT1",
    });
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "layout-3",
      kind: "printers",
      value: "2",
    });
  });

  it("leaves customer-wide facts free", async () => {
    await customerWithSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      kind: "contract",
      value: "annual",
    });
  });
});
