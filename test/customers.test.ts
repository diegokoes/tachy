import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  listCustomers,
  resolveCustomerByEmail,
  getCustomerIdBySlug,
  resolveCustomer,
  getCustomerName,
  linkRepo,
  listRepos,
  addComponent,
  setCustomerFact,
  listCustomerFacts,
  listCustomerFactKinds,
  linkCustomerComponent,
  unlinkCustomerComponent,
  getCustomerProfile,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

// File scope, not inside the first describe: a later block would otherwise run
// against a pool that has already been closed.
afterAll(() => sql.end());

describe("customers", () => {
  beforeEach(resetData);

  it("starts empty and lists what's added", async () => {
    expect(await listCustomers()).toEqual([]);
    await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      aliases: ["davidoff.com"],
    });
    const rows = await listCustomers();
    expect(rows.map((r) => r.slug)).toEqual(["davidoff"]);
  });

  it("resolves by email domain, including a partner who fronts for them", async () => {
    const c = await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      emailDomains: ["davidoff.com", "arvato.com"],
    });
    expect((await resolveCustomerByEmail("user@davidoff.com")).customerId).toBe(
      c.id,
    );
    expect((await resolveCustomerByEmail("agent@arvato.com")).customerId).toBe(
      c.id,
    );
    expect(
      (await resolveCustomerByEmail("user@unrelated.com")).customerId,
    ).toBeNull();
    expect((await resolveCustomerByEmail(undefined)).customerId).toBeNull();
  });

  it("normalizes domains, so '@Foo.COM' and 'foo.com' are the same rule", async () => {
    const c = await addCustomer({
      name: "Logista",
      slug: "logista",
      emailDomains: [" @TabacaleraCigar.com "],
    });
    expect(
      (await resolveCustomerByEmail("Javier@TABACALERACIGAR.com")).customerId,
    ).toBe(c.id);
  });

  it("a name alias is not an email domain", async () => {
    await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      aliases: ["Oettinger Davidoff", "davidoff.com"],
    });
    const hit = await resolveCustomerByEmail("user@davidoff.com");
    expect(hit.customerId).toBeNull();
  });

  it("refuses to guess when a partner domain fronts for two customers", async () => {
    await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      emailDomains: ["arvato.com"],
    });
    await addCustomer({
      name: "Villiger",
      slug: "villiger",
      emailDomains: ["arvato.com"],
    });
    const hit = await resolveCustomerByEmail("agent@arvato.com");
    expect(hit.customerId).toBeNull();
    expect(hit.reason).toMatch(/registered to 2 customers/);
    expect(hit.reason).toContain("davidoff");
    expect(hit.reason).toContain("villiger");
  });

  it("still resolves a customer whose slug is its domain", async () => {
    const c = await addCustomer({ name: "Acme", slug: "acme.com" });
    expect((await resolveCustomerByEmail("bob@acme.com")).customerId).toBe(
      c.id,
    );
  });

  it("scopes a repo to a customer, and shared repos come with it", async () => {
    await addCustomer({ name: "Villiger", slug: "villiger" });
    await addCustomer({ name: "Logista", slug: "logista" });
    await linkRepo({
      slug: "addon-villiger",
      url: "file:///tmp/av",
      customerSlug: "villiger",
    });
    await linkRepo({
      slug: "addon-logista",
      url: "file:///tmp/al",
      customerSlug: "logista",
    });
    await linkRepo({ slug: "tnt-tpd-portal", url: "file:///tmp/portal" });

    const villigerId = await getCustomerIdBySlug("villiger");
    const withShared = await listRepos({ customerId: villigerId });
    expect(withShared.map((r) => r.slug).sort()).toEqual([
      "addon-villiger",
      "tnt-tpd-portal",
    ]);
    expect(
      withShared.find((r) => r.slug === "addon-villiger")?.customer_slug,
    ).toBe("villiger");

    const theirsOnly = await listRepos({
      customerId: villigerId,
      includeShared: false,
    });
    expect(theirsOnly.map((r) => r.slug)).toEqual(["addon-villiger"]);
  });

  it("getCustomerIdBySlug throws a clear error for an unknown slug", async () => {
    await expect(getCustomerIdBySlug("nope")).rejects.toThrow(
      /Unknown customer 'nope'/,
    );
  });

  it("getCustomerName resolves a name, and is null-safe", async () => {
    const c = await addCustomer({ name: "Davidoff", slug: "davidoff" });
    expect(await getCustomerName(c.id)).toBe("Davidoff");
    expect(await getCustomerName(null)).toBeNull();
  });
});

describe("customer profile", () => {
  beforeEach(resetData);

  it("keeps one answer per (kind, label), so a version updates in place", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    const id = await getCustomerIdBySlug("logista");
    await setCustomerFact({
      customerSlug: "logista",
      kind: "version",
      label: "TPD Standard",
      value: "4.2.0",
    });
    await setCustomerFact({
      customerSlug: "logista",
      kind: "version",
      label: "TPD Standard",
      value: "4.2.1",
    });
    // A different label is a different question, so it coexists.
    await setCustomerFact({
      customerSlug: "logista",
      kind: "version",
      label: "Portal",
      value: "9.1",
    });
    const facts = await listCustomerFacts(id);
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ["Portal", "9.1"],
      ["TPD Standard", "4.2.1"],
    ]);
  });

  it("reports the fact kinds in use, so callers reuse one", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    for (const [customerSlug, kind, value] of [
      ["logista", "version", "4.2.1"],
      ["villiger", "version", "4.1.0"],
      ["logista", "layout", "3 lines"],
    ] as const)
      await setCustomerFact({ customerSlug, kind, value });
    expect(await listCustomerFactKinds()).toEqual([
      { kind: "version", count: 2 },
      { kind: "layout", count: 1 },
    ]);
  });

  it("links components many-to-many and gathers the whole profile", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await addComponent({ productId, slug: "aggregation", name: "Aggregation" });

    // A shared component has several customers; a specific one has just the one.
    await linkCustomerComponent("logista", productId, "printer");
    await linkCustomerComponent("villiger", productId, "printer");
    await linkCustomerComponent("logista", productId, "aggregation");
    await linkRepo({
      slug: "addon-logista",
      url: "file:///tmp/al",
      customerSlug: "logista",
    });
    await setCustomerFact({
      customerSlug: "logista",
      kind: "version",
      value: "4.2.1",
    });

    const profile = await getCustomerProfile(
      await getCustomerIdBySlug("logista"),
    );
    expect(profile?.components.map((c) => c.slug).sort()).toEqual([
      "aggregation",
      "printer",
    ]);
    expect(profile?.repos.map((r) => r.slug)).toEqual(["addon-logista"]);
    expect(profile?.facts).toEqual([
      { kind: "version", label: "", value: "4.2.1", component: null },
    ]);

    const villiger = await getCustomerProfile(
      await getCustomerIdBySlug("villiger"),
    );
    expect(villiger?.components.map((c) => c.slug)).toEqual(["printer"]);

    await unlinkCustomerComponent("logista", productId, "printer");
    const after = await getCustomerProfile(
      await getCustomerIdBySlug("logista"),
    );
    expect(after?.components.map((c) => c.slug)).toEqual(["aggregation"]);
  });
});

describe("customer resolution by slug or alias", () => {
  beforeEach(resetData);

  it("resolves an alias to the customer, case-insensitively", async () => {
    const c = await addCustomer({
      name: "Imperial Brands",
      slug: "itg",
      aliases: ["Altadis", "Imperial Tobacco"],
    });
    expect((await resolveCustomer("itg")).id).toBe(c.id);
    expect((await resolveCustomer("altadis")).id).toBe(c.id);
    expect((await resolveCustomer("IMPERIAL TOBACCO")).id).toBe(c.id);
    expect(await getCustomerIdBySlug("Altadis")).toBe(c.id);
  });

  it("prefers an exact slug over another customer's alias for the same string", async () => {
    const real = await addCustomer({ name: "Altadis SA", slug: "altadis" });
    await addCustomer({ name: "Imperial", slug: "itg", aliases: ["altadis"] });
    expect((await resolveCustomer("altadis")).id).toBe(real.id);
  });

  it("refuses an alias two customers both claim rather than guessing", async () => {
    await addCustomer({ name: "One", slug: "one", aliases: ["shared"] });
    await addCustomer({ name: "Two", slug: "two", aliases: ["shared"] });
    await expect(resolveCustomer("shared")).rejects.toThrow(/Ambiguous/);
  });

  it("names the nearest customers on a miss", async () => {
    await addCustomer({ name: "Davidoff", slug: "davidoff" });
    await expect(resolveCustomer("davidof")).rejects.toThrow(
      /Nearest matches: 'davidoff'/,
    );
  });
});
