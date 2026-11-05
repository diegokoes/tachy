import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  addCustomerUnit,
  addUnitKind,
  getCustomerIdBySlug,
  getCustomerProfile,
  getProductIdBySlug,
  resolveUnitAnywhere,
  searchCustomers,
  setCustomerFact,
} from "@tachy/core/catalog";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { saveReferenceDoc } from "@tachy/core/reference";
import { resetData, sql, tqxProductId } from "../database";

afterAll(() => sql.end());

/** Two customers: one with lines in a site, one with integrations in another product. */
async function twoSetups() {
  const tqx = await tqxProductId();
  const reporting = await getProductIdBySlug("fqlink");
  await addCustomer({
    name: "Ilverton Brands",
    slug: "ivk",
    aliases: ["Altavon"],
  });
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "calderra",
    name: "Calderra",
    kind: "site",
    productId: tqx,
  });
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "pln191",
    name: "PLN191",
    kind: "line",
    productId: tqx,
    parentSlug: "calderra",
  });
  await setCustomerFact({
    customerSlug: "ivk",
    unit: "pln191",
    kind: "coding_mode",
    value: "CT2",
  });
  await addCustomer({ name: "Losvane", slug: "losvane" });
  await addCustomerUnit({
    customerSlug: "losvane",
    slug: "sap",
    name: "SAP",
    kind: "integration",
    productId: reporting,
  });
  await setCustomerFact({
    customerSlug: "losvane",
    unit: "sap",
    kind: "connection",
    value: "SAP IDoc over RFC, nightly",
  });
  return { tqx, reporting };
}

describe("searching customer data", () => {
  beforeEach(resetData);

  it("finds a customer by an alias, a unit by its name, and a fact by its value", async () => {
    await twoSetups();
    expect((await searchCustomers("altavon")).customers).toEqual([
      { slug: "ivk", name: "Ilverton Brands" },
    ]);
    expect((await searchCustomers("PLN191")).units).toEqual([
      {
        customer: "ivk",
        slug: "pln191",
        name: "PLN191",
        kind: "line",
        product: "tqx",
      },
    ]);
    expect((await searchCustomers("idoc")).facts).toEqual([
      {
        customer: "losvane",
        unit: "sap",
        kind: "connection",
        label: "",
        value: "SAP IDoc over RFC, nightly",
      },
    ]);
  });

  it("narrows to one product's setups", async () => {
    const { reporting } = await twoSetups();
    const found = await searchCustomers("s", { productId: reporting });
    expect(found.units.map((u) => u.slug)).toEqual(["sap"]);
    expect(found.customers.map((c) => c.slug)).toEqual(["losvane"]);
  });

  it("reads percent and underscore as text, and refuses an empty query", async () => {
    await twoSetups();
    expect((await searchCustomers("%")).facts).toEqual([]);
    await expect(searchCustomers("  ")).rejects.toThrow(/query is required/);
  });
});

describe("a unit named without its customer", () => {
  beforeEach(resetData);

  it("resolves when one customer has it, and names the candidates when two do", async () => {
    await twoSetups();
    expect((await resolveUnitAnywhere("pln191")).customer_slug).toBe("ivk");
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "pln191",
      name: "Their own PLN191",
      kind: "line",
    });
    await expect(resolveUnitAnywhere("pln191")).rejects.toThrow(
      /'ivk\/pln191', 'losvane\/pln191'/,
    );
    await expect(resolveUnitAnywhere("nowhere")).rejects.toThrow(
      /search_customers/,
    );
  });
});

describe("the profile read", () => {
  beforeEach(resetData);

  it("keeps the customer read to customer-wide facts, with what is filed and what disagrees", async () => {
    const { tqx } = await twoSetups();
    await setCustomerFact({
      customerSlug: "ivk",
      kind: "contract",
      value: "annual",
    });
    await saveKnowledgeEntry({
      productId: tqx,
      title: "Printer stops on PLN191",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "ivk",
      unit: "pln191",
      status: "approved",
    });
    // A blueprint written after the setup: the line now has a fact it does not list.
    await addUnitKind({ productId: tqx, slug: "site", name: "Site" });
    await addUnitKind({
      productId: tqx,
      slug: "line",
      name: "Line",
      parentKind: "site",
      facts: [{ kind: "ip" }],
    });
    const profile = (await getCustomerProfile(
      await getCustomerIdBySlug("ivk"),
    ))!;
    expect(profile.facts.map((f) => f.kind)).toEqual(["contract"]);
    expect(profile.library).toEqual({ entries: 1, docs: 0 });
    expect(profile.conflicts).toEqual([
      {
        unit: "pln191",
        problem: expect.stringMatching(/'coding_mode' is not a fact of a line/),
      },
    ]);
  });

  it("reads one unit with what its blueprint misses and what is filed around it", async () => {
    const { tqx } = await twoSetups();
    await addUnitKind({
      productId: tqx,
      slug: "site",
      name: "Site",
      facts: [{ kind: "timezone" }],
    });
    await addUnitKind({
      productId: tqx,
      slug: "line",
      name: "Line",
      parentKind: "site",
      facts: [{ kind: "coding_mode" }, { kind: "ip" }],
    });
    const siteDoc = await saveReferenceDoc({
      title: "Calderra network plan",
      body: "Addresses per hall.",
      productId: tqx,
      customerSlug: "ivk",
      unit: "calderra",
    });
    const entry = await saveKnowledgeEntry({
      productId: tqx,
      title: "Printer stops on PLN191",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "ivk",
      unit: "pln191",
      status: "approved",
    });
    const customerId = await getCustomerIdBySlug("ivk");

    const line = (await getCustomerProfile(customerId, "pln191"))!;
    expect(line.unit).toEqual({
      slug: "pln191",
      name: "PLN191",
      kind: "line",
      product: "tqx",
    });
    expect(line.missing).toEqual(["ip"]);
    expect(line.documents).toEqual([
      {
        id: siteDoc.id,
        title: "Calderra network plan",
        unit: "calderra",
        original: false,
      },
    ]);
    expect(line.entries?.map((e) => e.id)).toEqual([entry.id]);

    const site = (await getCustomerProfile(customerId, "calderra"))!;
    expect(site.missing).toEqual(["timezone"]);
    expect(site.entries?.map((e) => e.id)).toEqual([entry.id]);
  });
});
