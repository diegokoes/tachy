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
  addCustomerUnit,
  deleteCustomer,
  deleteCustomerFact,
  linkCustomerProduct,
  unlinkCustomerProduct,
  getProductIdBySlug,
  setWorkItemCustomer,
} from "@tachy/core/catalog";
import { linkRepo, listRepos } from "@tachy/core/code";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { saveReferenceDoc } from "@tachy/core/reference";
import { resetData, sql, tpdProductId } from "../database";

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
    const customer = await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      emailDomains: ["davidoff.com", "arvato.com"],
    });
    expect((await resolveCustomerByEmail("user@davidoff.com")).customerId).toBe(
      customer.id,
    );
    expect((await resolveCustomerByEmail("agent@arvato.com")).customerId).toBe(
      customer.id,
    );
    expect(
      (await resolveCustomerByEmail("user@unrelated.com")).customerId,
    ).toBeNull();
    expect((await resolveCustomerByEmail(undefined)).customerId).toBeNull();
  });

  it("normalizes domains, so '@Foo.COM' and 'foo.com' are the same rule", async () => {
    const customer = await addCustomer({
      name: "Logista",
      slug: "logista",
      emailDomains: [" @TabacaleraCigar.com "],
    });
    expect(
      (await resolveCustomerByEmail("Javier@TABACALERACIGAR.com")).customerId,
    ).toBe(customer.id);
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
    const customer = await addCustomer({ name: "Acme", slug: "acme.com" });
    expect((await resolveCustomerByEmail("bob@acme.com")).customerId).toBe(
      customer.id,
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
      /unknown customer 'nope'/,
    );
  });

  it("getCustomerName resolves a name, and is null-safe", async () => {
    const customer = await addCustomer({ name: "Davidoff", slug: "davidoff" });
    expect(await getCustomerName(customer.id)).toBe("Davidoff");
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

    // A shared component has several customers; a specific one has one.
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
      {
        kind: "version",
        label: "",
        value: "4.2.1",
        component: null,
        doc: null,
      },
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
    const customer = await addCustomer({
      name: "Imperial Brands",
      slug: "itg",
      aliases: ["Altadis", "Imperial Tobacco"],
    });
    expect((await resolveCustomer("itg")).id).toBe(customer.id);
    expect((await resolveCustomer("altadis")).id).toBe(customer.id);
    expect((await resolveCustomer("IMPERIAL TOBACCO")).id).toBe(customer.id);
    expect(await getCustomerIdBySlug("Altadis")).toBe(customer.id);
  });

  it("prefers an exact slug over another customer's alias for the same string", async () => {
    const real = await addCustomer({ name: "Altadis SA", slug: "altadis" });
    await addCustomer({ name: "Imperial", slug: "itg", aliases: ["altadis"] });
    expect((await resolveCustomer("altadis")).id).toBe(real.id);
  });

  it("refuses an alias two customers both claim rather than guessing", async () => {
    await addCustomer({ name: "One", slug: "one", aliases: ["shared"] });
    await addCustomer({ name: "Two", slug: "two", aliases: ["shared"] });
    await expect(resolveCustomer("shared")).rejects.toThrow(/ambiguous/);
  });

  it("names the nearest customers on a miss", async () => {
    await addCustomer({ name: "Davidoff", slug: "davidoff" });
    await expect(resolveCustomer("davidof")).rejects.toThrow(
      /Nearest matches: 'davidoff'/,
    );
  });
});

describe("the products a customer uses", () => {
  beforeEach(resetData);

  it("links a product when the customer is added with it, and lists it", async () => {
    await addCustomer({
      name: "Logista",
      slug: "logista",
      productIds: [await tpdProductId()],
    });
    expect((await listCustomers())[0].products).toEqual(["tpd"]);
  });

  it("links the product of a unit or a component added for them", async () => {
    const productId = await tpdProductId();
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
      productId,
    });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await linkCustomerComponent("villiger", productId, "printer");
    const rows = await listCustomers();
    expect(rows.map((r) => [r.slug, r.products])).toEqual([
      ["logista", ["tpd"]],
      ["villiger", ["tpd"]],
    ]);
  });

  it("narrows the list to a product, or to who runs a component", async () => {
    const productId = await tpdProductId();
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    await addCustomer({ name: "Davidoff", slug: "davidoff" });
    await linkCustomerProduct(await getCustomerIdBySlug("villiger"), productId);
    await linkCustomerComponent("logista", productId, "printer");
    const users = await listCustomers({ productId });
    expect(users.map((r) => r.slug)).toEqual(["logista", "villiger"]);
    const [printer] =
      await sql`select id from components where slug = 'printer'`;
    const runners = await listCustomers({ componentId: printer.id as string });
    expect(runners.map((r) => r.slug)).toEqual(["logista"]);
  });

  it("refuses to unlink a product the customer still has units of", async () => {
    const productId = await tpdProductId();
    await addCustomer({ name: "Logista", slug: "logista" });
    const customerId = await getCustomerIdBySlug("logista");
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
      productId,
    });
    await expect(unlinkCustomerProduct(customerId, productId)).rejects.toThrow(
      /1 unit\(s\) in this product's setup/,
    );
    await sql`delete from customer_units`;
    await unlinkCustomerProduct(customerId, productId);
    expect((await listCustomers())[0].products).toEqual([]);
  });
});

describe("deleting a customer", () => {
  beforeEach(resetData);

  it("refuses while entries or docs are filed under them, naming the counts", async () => {
    const productId = await tpdProductId();
    await addCustomer({ name: "Logista", slug: "logista" });
    await saveKnowledgeEntry({
      productId,
      title: "Printer stops",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "logista",
      status: "approved",
    });
    await saveReferenceDoc({
      title: "Logista addon",
      body: "How their addon works.",
      productId,
      customerSlug: "logista",
    });
    await expect(deleteCustomer("logista")).rejects.toThrow(
      /1 entries, 1 docs filed under it/,
    );
  });

  it("takes their units, facts and links with them when nothing is filed", async () => {
    await addCustomer({
      name: "Logista",
      slug: "logista",
      productIds: [await tpdProductId()],
    });
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
    });
    await setCustomerFact({
      customerSlug: "logista",
      unit: "madrid",
      kind: "timezone",
      value: "Europe/Madrid",
    });
    await deleteCustomer("logista");
    const [left] = await sql`
      select (select count(*)::int from customer_units) as units,
             (select count(*)::int from customer_facts) as facts,
             (select count(*)::int from customer_products) as products
    `;
    expect(left).toEqual({ units: 0, facts: 0, products: 0 });
  });
});

describe("what a fact may hold", () => {
  beforeEach(resetData);

  it("refuses a credential or a card number, naming the field", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await expect(
      setCustomerFact({
        customerSlug: "logista",
        kind: "sftp",
        value: "password: hunter2",
      }),
    ).rejects.toThrow(/value looks like a credential/);
    await expect(
      setCustomerFact({
        customerSlug: "logista",
        kind: "billing",
        value: "on file",
        notes: "card 4111 1111 1111 1111",
      }),
    ).rejects.toThrow(/notes looks like a credential or a card number/);
    await expect(
      addCustomer({
        name: "Villiger",
        slug: "villiger",
        notes: "token=abc123",
      }),
    ).rejects.toThrow(/notes looks like/);
  });

  it("names the unit of a unit's fact in the flat list", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
    });
    await setCustomerFact({
      customerSlug: "logista",
      unit: "madrid",
      kind: "timezone",
      value: "Europe/Madrid",
    });
    await setCustomerFact({
      customerSlug: "logista",
      kind: "contract",
      value: "annual",
    });
    const facts = await listCustomerFacts(await getCustomerIdBySlug("logista"));
    expect(facts.map((f) => [f.unit_slug, f.kind])).toEqual([
      [null, "contract"],
      ["madrid", "timezone"],
    ]);
  });

  it("deletes a fact only through the customer it belongs to", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomer({ name: "Villiger", slug: "villiger" });
    const fact = await setCustomerFact({
      customerSlug: "logista",
      kind: "contract",
      value: "annual",
    });
    await expect(
      deleteCustomerFact(await getCustomerIdBySlug("villiger"), fact.id),
    ).rejects.toThrow(/not found/);
    await deleteCustomerFact(await getCustomerIdBySlug("logista"), fact.id);
    expect(
      await listCustomerFacts(await getCustomerIdBySlug("logista")),
    ).toEqual([]);
  });
});

describe("filing under a product's unit", () => {
  beforeEach(resetData);

  async function trackAndTraceLine() {
    await addCustomer({ name: "Logista", slug: "logista" });
    await addCustomerUnit({
      customerSlug: "logista",
      slug: "line-1",
      name: "Line 1",
      kind: "line",
      productId: await tpdProductId(),
    });
  }

  it("refuses an entry or a doc of another product", async () => {
    await trackAndTraceLine();
    const ftrace = await getProductIdBySlug("ftrace");
    await expect(
      saveKnowledgeEntry({
        productId: ftrace,
        title: "Fleet sync stalls",
        issueSummary: "Sync stalls.",
        customerSlug: "logista",
        unit: "line-1",
        status: "approved",
      }),
    ).rejects.toThrow(/part of the tpd setup/);
    await expect(
      saveReferenceDoc({
        title: "Fleet guide",
        body: "How fleets sync.",
        productId: ftrace,
        customerSlug: "logista",
        unit: "line-1",
      }),
    ).rejects.toThrow(/part of the tpd setup/);
  });

  it("refuses a ticket of another product, and takes one with none", async () => {
    await trackAndTraceLine();
    const customerId = await getCustomerIdBySlug("logista");
    const [ftraceTicket, unrouted] = await sql`
      insert into work_items (source_connection_id, external_id, kind, title, product_id)
      select sc.id, x.external_id, 'ticket', 'sync stalls', x.product_id
      from source_connections sc,
           (values ('wi-ftrace', (select id from products where slug = 'ftrace')),
                   ('wi-none', null::uuid)) as x(external_id, product_id)
      where sc.slug = 'test-freshdesk'
      returning id
    `;
    await expect(
      setWorkItemCustomer(ftraceTicket.id as string, customerId, "line-1"),
    ).rejects.toThrow(/part of the tpd setup/);
    await setWorkItemCustomer(unrouted.id as string, customerId, "line-1");
  });
});

describe("a fact's doc", () => {
  beforeEach(resetData);

  async function layoutDoc() {
    return saveReferenceDoc({
      title: "TLC191 layout",
      body: "Electrical layout of the line.",
      productId: await tpdProductId(),
      customerSlug: "logista",
    });
  }

  it("links a fact to a doc, keeps the link on a re-set, and clears it with null", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    const doc = await layoutDoc();
    const customerId = await getCustomerIdBySlug("logista");
    await setCustomerFact({
      customerSlug: "logista",
      kind: "layout",
      value: "two printers, one camera",
      docId: doc.id,
    });
    await setCustomerFact({
      customerSlug: "logista",
      kind: "layout",
      value: "two printers, two cameras",
    });
    const [kept] = await listCustomerFacts(customerId);
    expect(kept).toMatchObject({ doc_id: doc.id, doc_title: "TLC191 layout" });
    const profile = await getCustomerProfile(customerId);
    expect(profile?.facts[0].doc).toEqual({
      id: doc.id,
      title: "TLC191 layout",
    });

    await setCustomerFact({
      customerSlug: "logista",
      kind: "layout",
      value: "two printers, two cameras",
      docId: null,
    });
    expect((await listCustomerFacts(customerId))[0].doc_id).toBeNull();
  });

  it("refuses a doc that does not exist, or a superseded version", async () => {
    await addCustomer({ name: "Logista", slug: "logista" });
    const old = await layoutDoc();
    const current = await saveReferenceDoc({
      title: "TLC191 layout v2",
      body: "Electrical layout of the line, second issue.",
      productId: await tpdProductId(),
      supersedes: old.id,
    });
    await expect(
      setCustomerFact({
        customerSlug: "logista",
        kind: "layout",
        value: "v1",
        docId: old.id,
      }),
    ).rejects.toThrow(new RegExp(`superseded by '${current.id}'`));
    await expect(
      setCustomerFact({
        customerSlug: "logista",
        kind: "layout",
        value: "v1",
        docId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not found/);
  });
});
