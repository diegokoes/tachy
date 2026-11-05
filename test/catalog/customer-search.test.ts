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
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

/** Two customers: one with lines in a site, one with integrations in another product. */
async function twoSetups() {
  const tpd = await tpdProductId();
  const reporting = await getProductIdBySlug("ftrace");
  await addCustomer({
    name: "Imperial Brands",
    slug: "itg",
    aliases: ["Altadis"],
  });
  await addCustomerUnit({
    customerSlug: "itg",
    slug: "cantabria",
    name: "Cantabria",
    kind: "site",
    productId: tpd,
  });
  await addCustomerUnit({
    customerSlug: "itg",
    slug: "tlc191",
    name: "TLC191",
    kind: "line",
    productId: tpd,
    parentSlug: "cantabria",
  });
  await setCustomerFact({
    customerSlug: "itg",
    unit: "tlc191",
    kind: "coding_mode",
    value: "CT2",
  });
  await addCustomer({ name: "Logista", slug: "logista" });
  await addCustomerUnit({
    customerSlug: "logista",
    slug: "sap",
    name: "SAP",
    kind: "integration",
    productId: reporting,
  });
  await setCustomerFact({
    customerSlug: "logista",
    unit: "sap",
    kind: "connection",
    value: "SAP IDoc over RFC, nightly",
  });
  return { tpd, reporting };
}

describe("searching customer data", () => {
  beforeEach(resetData);

  it("finds a customer by an alias, a unit by its name, and a fact by its value", async () => {
    await twoSetups();
    expect((await searchCustomers("altadis")).customers).toEqual([
      { slug: "itg", name: "Imperial Brands" },
    ]);
    expect((await searchCustomers("TLC191")).units).toEqual([
      {
        customer: "itg",
        slug: "tlc191",
        name: "TLC191",
        kind: "line",
        product: "tpd",
      },
    ]);
    expect((await searchCustomers("idoc")).facts).toEqual([
      {
        customer: "logista",
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
    expect(found.customers.map((c) => c.slug)).toEqual(["logista"]);
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
    expect((await resolveUnitAnywhere("tlc191")).customer_slug).toBe("itg");
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "tlc191",
      name: "Their own TLC191",
      kind: "line",
    });
    await expect(resolveUnitAnywhere("tlc191")).rejects.toThrow(
      /'itg\/tlc191', 'logista\/tlc191'/,
    );
    await expect(resolveUnitAnywhere("nowhere")).rejects.toThrow(
      /search_customers/,
    );
  });
});

describe("the profile read", () => {
  beforeEach(resetData);

  it("keeps the customer read to customer-wide facts, with what is filed and what disagrees", async () => {
    const { tpd } = await twoSetups();
    await setCustomerFact({
      customerSlug: "itg",
      kind: "contract",
      value: "annual",
    });
    await saveKnowledgeEntry({
      productId: tpd,
      title: "Printer stops on TLC191",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "itg",
      unit: "tlc191",
      status: "approved",
    });
    // A blueprint written after the setup: the line now has a fact it does not list.
    await addUnitKind({ productId: tpd, slug: "site", name: "Site" });
    await addUnitKind({
      productId: tpd,
      slug: "line",
      name: "Line",
      parentKind: "site",
      facts: [{ kind: "ip" }],
    });
    const profile = (await getCustomerProfile(
      await getCustomerIdBySlug("itg"),
    ))!;
    expect(profile.facts.map((f) => f.kind)).toEqual(["contract"]);
    expect(profile.library).toEqual({ entries: 1, docs: 0 });
    expect(profile.conflicts).toEqual([
      {
        unit: "tlc191",
        problem: expect.stringMatching(/'coding_mode' is not a fact of a line/),
      },
    ]);
  });

  it("reads one unit with what its blueprint misses and what is filed around it", async () => {
    const { tpd } = await twoSetups();
    await addUnitKind({
      productId: tpd,
      slug: "site",
      name: "Site",
      facts: [{ kind: "timezone" }],
    });
    await addUnitKind({
      productId: tpd,
      slug: "line",
      name: "Line",
      parentKind: "site",
      facts: [{ kind: "coding_mode" }, { kind: "ip" }],
    });
    const siteDoc = await saveReferenceDoc({
      title: "Cantabria network plan",
      body: "Addresses per hall.",
      productId: tpd,
      customerSlug: "itg",
      unit: "cantabria",
    });
    const entry = await saveKnowledgeEntry({
      productId: tpd,
      title: "Printer stops on TLC191",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "itg",
      unit: "tlc191",
      status: "approved",
    });
    const customerId = await getCustomerIdBySlug("itg");

    const line = (await getCustomerProfile(customerId, "tlc191"))!;
    expect(line.unit).toEqual({
      slug: "tlc191",
      name: "TLC191",
      kind: "line",
      product: "tpd",
    });
    expect(line.missing).toEqual(["ip"]);
    expect(line.documents).toEqual([
      {
        id: siteDoc.id,
        title: "Cantabria network plan",
        unit: "cantabria",
        original: false,
      },
    ]);
    expect(line.entries?.map((e) => e.id)).toEqual([entry.id]);

    const site = (await getCustomerProfile(customerId, "cantabria"))!;
    expect(site.missing).toEqual(["timezone"]);
    expect(site.entries?.map((e) => e.id)).toEqual([entry.id]);
  });
});
