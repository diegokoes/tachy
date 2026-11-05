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
import {
  addSourceConnection,
  addSourceProject,
  deleteSourceConnection,
} from "@tachy/core/sources";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { saveReferenceDoc } from "@tachy/core/reference";
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
    expect(profile?.repos).toEqual([
      {
        slug: "addon-losvane",
        component: null,
        index_status: "idle",
        url: null,
      },
    ]);
    expect(profile?.facts).toEqual([
      {
        kind: "version",
        label: "",
        value: "4.2.1",
        component: null,
        doc: null,
      },
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

describe("the customer's sources", () => {
  beforeEach(resetData);

  it("links each repo and project to its own page", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await linkRepo({
      slug: "addon-portal",
      url: "https://github.com/acme/portal.git",
      customerSlug: "losvane",
    });
    // Connections outlive resetData, and other files list them: this one goes again.
    await addSourceConnection({
      sourceType: "azure-devops",
      slug: "customer-pages-ado",
      baseUrl: "https://dev.azure.com/acme",
    });
    try {
      await addSourceProject({
        sourceSlug: "customer-pages-ado",
        externalKey: "Losvane Addons",
        productSlug: "tqx",
        customerSlug: "losvane",
      });
      const profile = (await getCustomerProfile(
        await getCustomerIdBySlug("losvane"),
      ))!;
      expect(profile.repos.map((repo) => repo.url)).toEqual([
        "https://github.com/acme/portal",
      ]);
      expect(profile.projects).toEqual([
        {
          source_slug: "customer-pages-ado",
          external_key: "Losvane Addons",
          url: "https://dev.azure.com/acme/Losvane%20Addons",
        },
      ]);
    } finally {
      await deleteSourceConnection("customer-pages-ado");
    }
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

describe("the products a customer uses", () => {
  beforeEach(resetData);

  it("links a product when the customer is added with it, and lists it", async () => {
    await addCustomer({
      name: "Losvane",
      slug: "losvane",
      productIds: [await tqxProductId()],
    });
    expect((await listCustomers())[0].products).toEqual(["tqx"]);
  });

  it("links the product of a unit or a component added for them", async () => {
    const productId = await tqxProductId();
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
      productId,
    });
    await addCustomer({ name: "Velmora", slug: "velmora" });
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await linkCustomerComponent("velmora", productId, "printer");
    const rows = await listCustomers();
    expect(rows.map((r) => [r.slug, r.products])).toEqual([
      ["losvane", ["tqx"]],
      ["velmora", ["tqx"]],
    ]);
  });

  it("narrows the list to a product, or to who runs a component", async () => {
    const productId = await tqxProductId();
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomer({ name: "Velmora", slug: "velmora" });
    await addCustomer({ name: "Dalmoor", slug: "dalmoor" });
    await linkCustomerProduct(await getCustomerIdBySlug("velmora"), productId);
    await linkCustomerComponent("losvane", productId, "printer");
    const users = await listCustomers({ productId });
    expect(users.map((r) => r.slug)).toEqual(["losvane", "velmora"]);
    const [printer] =
      await sql`select id from components where slug = 'printer'`;
    const runners = await listCustomers({ componentId: printer.id as string });
    expect(runners.map((r) => r.slug)).toEqual(["losvane"]);
  });

  it("refuses to unlink a product the customer still has units of", async () => {
    const productId = await tqxProductId();
    await addCustomer({ name: "Losvane", slug: "losvane" });
    const customerId = await getCustomerIdBySlug("losvane");
    await addCustomerUnit({
      customerSlug: "losvane",
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
    const productId = await tqxProductId();
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await saveKnowledgeEntry({
      productId,
      title: "Printer stops",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "losvane",
      status: "approved",
    });
    await saveReferenceDoc({
      title: "Losvane addon",
      body: "How their addon works.",
      productId,
      customerSlug: "losvane",
    });
    await expect(deleteCustomer("losvane")).rejects.toThrow(
      /1 entry, 1 doc filed under it/,
    );
  });

  it("takes their units, facts and links with them when nothing is filed", async () => {
    await addCustomer({
      name: "Losvane",
      slug: "losvane",
      productIds: [await tqxProductId()],
    });
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
    });
    await setCustomerFact({
      customerSlug: "losvane",
      unit: "madrid",
      kind: "timezone",
      value: "Europe/Madrid",
    });
    await deleteCustomer("losvane");
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
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await expect(
      setCustomerFact({
        customerSlug: "losvane",
        kind: "sftp",
        value: "password: hunter2",
      }),
    ).rejects.toThrow(/value looks like a credential/);
    await expect(
      setCustomerFact({
        customerSlug: "losvane",
        kind: "billing",
        value: "on file",
        notes: "card 4111 1111 1111 1111",
      }),
    ).rejects.toThrow(/notes looks like a credential or a card number/);
    await expect(
      addCustomer({
        name: "Velmora",
        slug: "velmora",
        notes: "token=abc123",
      }),
    ).rejects.toThrow(/notes looks like/);
  });

  it("names the unit of a unit's fact in the flat list", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
    });
    await setCustomerFact({
      customerSlug: "losvane",
      unit: "madrid",
      kind: "timezone",
      value: "Europe/Madrid",
    });
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "contract",
      value: "annual",
    });
    const facts = await listCustomerFacts(await getCustomerIdBySlug("losvane"));
    expect(facts.map((f) => [f.unit_slug, f.kind])).toEqual([
      [null, "contract"],
      ["madrid", "timezone"],
    ]);
  });

  it("deletes a fact only through the customer it belongs to", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomer({ name: "Velmora", slug: "velmora" });
    const fact = await setCustomerFact({
      customerSlug: "losvane",
      kind: "contract",
      value: "annual",
    });
    await expect(
      deleteCustomerFact(await getCustomerIdBySlug("velmora"), fact.id),
    ).rejects.toThrow(/not found/);
    await deleteCustomerFact(await getCustomerIdBySlug("losvane"), fact.id);
    expect(
      await listCustomerFacts(await getCustomerIdBySlug("losvane")),
    ).toEqual([]);
  });
});

describe("filing under a product's unit", () => {
  beforeEach(resetData);

  async function trellisLine() {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "line-1",
      name: "Line 1",
      kind: "line",
      productId: await tqxProductId(),
    });
  }

  it("refuses an entry or a doc of another product", async () => {
    await trellisLine();
    const fqlink = await getProductIdBySlug("fqlink");
    await expect(
      saveKnowledgeEntry({
        productId: fqlink,
        title: "Fleet sync stalls",
        issueSummary: "Sync stalls.",
        customerSlug: "losvane",
        unit: "line-1",
        status: "approved",
      }),
    ).rejects.toThrow(/part of the tqx setup/);
    await expect(
      saveReferenceDoc({
        title: "Fleet guide",
        body: "How fleets sync.",
        productId: fqlink,
        customerSlug: "losvane",
        unit: "line-1",
      }),
    ).rejects.toThrow(/part of the tqx setup/);
  });

  it("refuses a ticket of another product, and takes one with none", async () => {
    await trellisLine();
    const customerId = await getCustomerIdBySlug("losvane");
    const [fqlinkTicket, unrouted] = await sql`
      insert into work_items (source_connection_id, external_id, kind, title, product_id)
      select sc.id, x.external_id, 'ticket', 'sync stalls', x.product_id
      from source_connections sc,
           (values ('wi-fqlink', (select id from products where slug = 'fqlink')),
                   ('wi-none', null::uuid)) as x(external_id, product_id)
      where sc.slug = 'test-freshdesk'
      returning id
    `;
    await expect(
      setWorkItemCustomer(fqlinkTicket.id as string, customerId, "line-1"),
    ).rejects.toThrow(/part of the tqx setup/);
    await setWorkItemCustomer(unrouted.id as string, customerId, "line-1");
  });
});

describe("a fact's doc", () => {
  beforeEach(resetData);

  async function layoutDoc() {
    return saveReferenceDoc({
      title: "PLN191 layout",
      body: "Electrical layout of the line.",
      productId: await tqxProductId(),
      customerSlug: "losvane",
    });
  }

  it("links a fact to a doc, keeps the link on a re-set, and clears it with null", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    const doc = await layoutDoc();
    const customerId = await getCustomerIdBySlug("losvane");
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "layout",
      value: "two printers, one camera",
      docId: doc.id,
    });
    await setCustomerFact({
      customerSlug: "losvane",
      kind: "layout",
      value: "two printers, two cameras",
    });
    const [kept] = await listCustomerFacts(customerId);
    expect(kept).toMatchObject({ doc_id: doc.id, doc_title: "PLN191 layout" });
    const profile = await getCustomerProfile(customerId);
    expect(profile?.facts[0].doc).toEqual({
      id: doc.id,
      title: "PLN191 layout",
    });

    await setCustomerFact({
      customerSlug: "losvane",
      kind: "layout",
      value: "two printers, two cameras",
      docId: null,
    });
    expect((await listCustomerFacts(customerId))[0].doc_id).toBeNull();
  });

  it("refuses a doc that does not exist, or a superseded version", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    const old = await layoutDoc();
    const current = await saveReferenceDoc({
      title: "PLN191 layout v2",
      body: "Electrical layout of the line, second issue.",
      productId: await tqxProductId(),
      supersedes: old.id,
    });
    await expect(
      setCustomerFact({
        customerSlug: "losvane",
        kind: "layout",
        value: "v1",
        docId: old.id,
      }),
    ).rejects.toThrow(new RegExp(`superseded by '${current.id}'`));
    await expect(
      setCustomerFact({
        customerSlug: "losvane",
        kind: "layout",
        value: "v1",
        docId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not found/);
  });
});
