import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  listCustomers,
  resolveCustomerByEmail,
  getCustomerIdBySlug,
  resolveCustomer,
  getCustomerName,
  addComponent,
  setCustomerFact,
  listCustomerFacts,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  getCustomerProfile,
} from "@tachy/core/catalog";
import { linkRepo, listRepos } from "@tachy/core/code";
import { resetData, sql, tqxProductId } from "../database";

// File scope, not inside the first describe: a later block would otherwise run
// against a pool that has already been closed.
afterAll(() => sql.end());

describe("customers", () => {
  beforeEach(resetData);

  it("starts empty and lists what's added", async () => {
    expect(await listCustomers()).toEqual([]);
    await addCustomer({
      name: "Dalmoor",
      slug: "dalmoor",
      aliases: ["dalmoor.example"],
    });
    const rows = await listCustomers();
    expect(rows.map((r) => r.slug)).toEqual(["dalmoor"]);
  });

  it("resolves by email domain, including a partner who fronts for them", async () => {
    const customer = await addCustomer({
      name: "Dalmoor",
      slug: "dalmoor",
      emailDomains: ["dalmoor.example", "arkwell.example"],
    });
    expect((await resolveCustomerByEmail("user@dalmoor.example")).customerId).toBe(
      customer.id,
    );
    expect((await resolveCustomerByEmail("agent@arkwell.example")).customerId).toBe(
      customer.id,
    );
    expect(
      (await resolveCustomerByEmail("user@unrelated.com")).customerId,
    ).toBeNull();
    expect((await resolveCustomerByEmail(undefined)).customerId).toBeNull();
  });

  it("normalizes domains, so '@Foo.COM' and 'foo.com' are the same rule", async () => {
    const customer = await addCustomer({
      name: "Losvane",
      slug: "losvane",
      emailDomains: [" @LosvaneTrade.example "],
    });
    expect(
      (await resolveCustomerByEmail("Javier@LOSVANETRADE.example")).customerId,
    ).toBe(customer.id);
  });

  it("a name alias is not an email domain", async () => {
    await addCustomer({
      name: "Dalmoor",
      slug: "dalmoor",
      aliases: ["Dalmoor Group", "dalmoor.example"],
    });
    const hit = await resolveCustomerByEmail("user@dalmoor.example");
    expect(hit.customerId).toBeNull();
  });

  it("refuses to guess when a partner domain fronts for two customers", async () => {
    await addCustomer({
      name: "Dalmoor",
      slug: "dalmoor",
      emailDomains: ["arkwell.example"],
    });
    await addCustomer({
      name: "Velmora",
      slug: "velmora",
      emailDomains: ["arkwell.example"],
    });
    const hit = await resolveCustomerByEmail("agent@arkwell.example");
    expect(hit.customerId).toBeNull();
    expect(hit.reason).toMatch(/registered to 2 customers/);
    expect(hit.reason).toContain("dalmoor");
    expect(hit.reason).toContain("velmora");
  });

  it("still resolves a customer whose slug is its domain", async () => {
    const customer = await addCustomer({ name: "Acme", slug: "acme.com" });
    expect((await resolveCustomerByEmail("bob@acme.com")).customerId).toBe(
      customer.id,
    );
  });

  it("scopes a repo to a customer, and shared repos come with it", async () => {
    await addCustomer({ name: "Velmora", slug: "velmora" });
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await linkRepo({
      slug: "addon-velmora",
      url: "file:///tmp/av",
      customerSlug: "velmora",
    });
    await linkRepo({
      slug: "addon-losvane",
      url: "file:///tmp/al",
      customerSlug: "losvane",
    });
    await linkRepo({ slug: "tvx-tqx-portal", url: "file:///tmp/portal" });

    const velmoraId = await getCustomerIdBySlug("velmora");
    const withShared = await listRepos({ customerId: velmoraId });
    expect(withShared.map((r) => r.slug).sort()).toEqual([
      "addon-velmora",
      "tvx-tqx-portal",
    ]);
    expect(
      withShared.find((r) => r.slug === "addon-velmora")?.customer_slug,
    ).toBe("velmora");

    const theirsOnly = await listRepos({
      customerId: velmoraId,
      includeShared: false,
    });
    expect(theirsOnly.map((r) => r.slug)).toEqual(["addon-velmora"]);
  });

  it("getCustomerIdBySlug throws a clear error for an unknown slug", async () => {
    await expect(getCustomerIdBySlug("nope")).rejects.toThrow(
      /unknown customer 'nope'/,
    );
  });

  it("getCustomerName resolves a name, and is null-safe", async () => {
    const customer = await addCustomer({ name: "Dalmoor", slug: "dalmoor" });
    expect(await getCustomerName(customer.id)).toBe("Dalmoor");
    expect(await getCustomerName(null)).toBeNull();
  });
});

describe("customer profile", () => {
  beforeEach(resetData);

  it("keeps one answer per (kind, label), so a version updates in place", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    const id = await getCustomerIdBySlug("losvane");
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "version",
      label: "TQX Standard",
      value: "4.2.0",
    });
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "version",
      label: "TQX Standard",
      value: "4.2.1",
    });
    // A different label is a different question, so it coexists.
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "version",
      label: "Portal",
      value: "9.1",
    });
    const facts = await listCustomerFacts(id);
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ["Portal", "9.1"],
      ["TQX Standard", "4.2.1"],
    ]);
  });

  it("reports the fact kinds in use, so callers reuse one", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomer({ name: "Velmora", slug: "velmora" });
    for (const [customerSlug, kind, value] of [
      ["losvane", "version", "4.2.1"],
      ["velmora", "version", "4.1.0"],
      ["losvane", "layout", "3 lines"],
    ] as const)
      await setCustomerFact({ customerSlug, kind, value });
    expect(await listCustomerFactKinds()).toEqual([
      { kind: "version", count: 2 },
      { kind: "layout", count: 1 },
    ]);
  });

  it("links components many-to-many and gathers the whole profile", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomer({ name: "Velmora", slug: "velmora" });
    const productId = await tqxProductId();
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await addComponent({ productId, slug: "aggregation", name: "Aggregation" });

    // A shared component has several customers; a specific one has one.
    await linkCustomerComponent("losvane", productId, "printer");
    await linkCustomerComponent("velmora", productId, "printer");
    await linkCustomerComponent("losvane", productId, "aggregation");
    await linkRepo({
      slug: "addon-losvane",
      url: "file:///tmp/al",
      customerSlug: "losvane",
    });
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "version",
      value: "4.2.1",
    });

    const profile = await getCustomerProfile(
      await getCustomerIdBySlug("losvane"),
    );
    expect(profile?.components.map((c) => c.slug).sort()).toEqual([
      "aggregation",
      "printer",
    ]);
    expect(profile?.repos.map((r) => r.slug)).toEqual(["addon-losvane"]);
    expect(profile?.facts).toEqual([
      { kind: "version", label: "", value: "4.2.1", component: null },
    ]);

    const velmora = await getCustomerProfile(
      await getCustomerIdBySlug("velmora"),
    );
    expect(velmora?.components.map((c) => c.slug)).toEqual(["printer"]);

    await unlinkCustomerComponent("losvane", productId, "printer");
    const after = await getCustomerProfile(
      await getCustomerIdBySlug("losvane"),
    );
    expect(after?.components.map((c) => c.slug)).toEqual(["aggregation"]);
  });
});

describe("customer resolution by slug or alias", () => {
  beforeEach(resetData);

  it("resolves an alias to the customer, case-insensitively", async () => {
    const customer = await addCustomer({
      name: "Ilverton Brands",
      slug: "ivk",
      aliases: ["Altavon", "Ilverton Trading"],
    });
    expect((await resolveCustomer("ivk")).id).toBe(customer.id);
    expect((await resolveCustomer("altavon")).id).toBe(customer.id);
    expect((await resolveCustomer("ILVERTON TRADING")).id).toBe(customer.id);
    expect(await getCustomerIdBySlug("Altavon")).toBe(customer.id);
  });

  it("prefers an exact slug over another customer's alias for the same string", async () => {
    const real = await addCustomer({ name: "Altavon SA", slug: "altavon" });
    await addCustomer({ name: "Ilverton", slug: "ivk", aliases: ["altavon"] });
    expect((await resolveCustomer("altavon")).id).toBe(real.id);
  });

  it("refuses an alias two customers both claim rather than guessing", async () => {
    await addCustomer({ name: "One", slug: "one", aliases: ["shared"] });
    await addCustomer({ name: "Two", slug: "two", aliases: ["shared"] });
    await expect(resolveCustomer("shared")).rejects.toThrow(/ambiguous/);
  });

  it("names the nearest customers on a miss", async () => {
    await addCustomer({ name: "Dalmoor", slug: "dalmoor" });
    await expect(resolveCustomer("davidof")).rejects.toThrow(
      /Nearest matches: 'dalmoor'/,
    );
  });
});
