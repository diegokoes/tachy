import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer,
  addCustomerUnit,
  updateCustomerUnit,
  deleteCustomerUnit,
  listCustomerUnits,
  resolveUnit,
  resolveUnitFacts,
  setCustomerFact,
  getCustomerIdBySlug,
  saveKnowledgeEntry,
  updateKnowledgeEntry,
  saveReferenceDoc,
  searchKnowledge,
  setWorkItemCustomer,
} from "@tachy/core";
import { resetData, sql, tpdProductId } from "./helpers";

afterAll(() => sql.end());

/**
 * The ITG shape, reduced to what the ladder needs: a site containing lines,
 * two of which conform to a shared layout that is not part of the estate.
 */
async function estate() {
  await addCustomer({ name: "Imperial Brands", slug: "itg" });
  const customerId = await getCustomerIdBySlug("itg");
  await addCustomerUnit({
    customerSlug: "itg",
    slug: "cantabria",
    name: "Altadis / Cantabria",
    kind: "site",
  });
  await addCustomerUnit({
    customerSlug: "itg",
    slug: "layout-3",
    name: "Layout 3",
    kind: "layout",
  });
  for (const slug of ["tlc191", "tlc192"])
    await addCustomerUnit({
      customerSlug: "itg",
      slug,
      name: slug.toUpperCase(),
      kind: "line",
      parentSlug: "cantabria",
      profileSlug: "layout-3",
    });
  await addCustomerUnit({
    customerSlug: "itg",
    slug: "tpc141",
    name: "TPC141",
    kind: "line",
    parentSlug: "cantabria",
  });
  return customerId;
}

const fact = (unit: string | null, kind: string, value: string, label = "") =>
  setCustomerFact({
    customerSlug: "itg",
    unit: unit ?? undefined,
    kind,
    label,
    value,
  });

const byKind = (facts: any[], kind: string) =>
  facts.find((f) => f.kind === kind);

describe("customer units", () => {
  beforeEach(resetData);

  it("models a site containing lines, with a layout beside it", async () => {
    const customerId = await estate();
    const units = await listCustomerUnits(customerId);
    expect(units.map((u) => u.slug).sort()).toEqual([
      "cantabria",
      "layout-3",
      "tlc191",
      "tlc192",
      "tpc141",
    ]);
    const line = units.find((u) => u.slug === "tlc191")!;
    const site = units.find((u) => u.slug === "cantabria")!;
    const layout = units.find((u) => u.slug === "layout-3")!;
    expect(line.parent_id).toBe(site.id);
    expect(line.profile_id).toBe(layout.id);
    // A layout is not part of the estate — it has no parent.
    expect(layout.parent_id).toBeNull();
  });

  it("resolves a unit by slug or alias, and hints on a miss", async () => {
    await estate();
    const customerId = await getCustomerIdBySlug("itg");
    await updateCustomerUnit(customerId, "tlc191", { aliases: ["line 191"] });
    expect((await resolveUnit(customerId, "LINE 191")).slug).toBe("tlc191");
    await expect(resolveUnit(customerId, "tlc19")).rejects.toThrow(
      /Nearest matches/,
    );
  });

  it("refuses a containment cycle and a profile cycle", async () => {
    await estate();
    const customerId = await getCustomerIdBySlug("itg");
    await expect(
      updateCustomerUnit(customerId, "cantabria", { parentSlug: "tlc191" }),
    ).rejects.toThrow(/cycle/);
    await expect(
      updateCustomerUnit(customerId, "tlc191", { parentSlug: "tlc191" }),
    ).rejects.toThrow(/contain itself/);
    // tlc191 already conforms to layout-3, so pointing the layout back at the
    // line is a cycle on the profile edge.
    await expect(
      updateCustomerUnit(customerId, "layout-3", { profileSlug: "tlc191" }),
    ).rejects.toThrow(/cycle/);
    await expect(
      updateCustomerUnit(customerId, "layout-3", { profileSlug: "layout-3" }),
    ).rejects.toThrow(/its own profile/);
    // A layout may still take a profile that does not lead back to it.
    await addCustomerUnit({
      customerSlug: "itg",
      slug: "base-layout",
      name: "Base layout",
      kind: "layout",
    });
    await updateCustomerUnit(customerId, "layout-3", {
      profileSlug: "base-layout",
    });
  });

  it("flattens rather than deletes a subtree when a level goes", async () => {
    await estate();
    const customerId = await getCustomerIdBySlug("itg");
    await deleteCustomerUnit(customerId, "cantabria");
    const units = await listCustomerUnits(customerId);
    expect(units.map((u) => u.slug).sort()).toEqual([
      "layout-3",
      "tlc191",
      "tlc192",
      "tpc141",
    ]);
    expect(units.find((u) => u.slug === "tlc191")!.parent_id).toBeNull();
  });

  it("keeps the lines when the layout they reference is deleted", async () => {
    await estate();
    const customerId = await getCustomerIdBySlug("itg");
    await deleteCustomerUnit(customerId, "layout-3");
    const units = await listCustomerUnits(customerId);
    expect(units.map((u) => u.slug)).toContain("tlc191");
    expect(units.find((u) => u.slug === "tlc191")!.profile_id).toBeNull();
  });
});

describe("the fact resolution ladder", () => {
  beforeEach(resetData);

  it("prefers the unit's own fact over everything above it", async () => {
    await estate();
    await fact(null, "coding_mode", "CUSTOMER");
    await fact("cantabria", "coding_mode", "SITE");
    await fact("layout-3", "coding_mode", "LAYOUT");
    await fact("tlc191", "coding_mode", "LINE");

    const f = byKind(
      await resolveUnitFacts(
        (await resolveUnit(await getCustomerIdBySlug("itg"), "tlc191")).id,
      ),
      "coding_mode",
    );
    expect(f.value).toBe("LINE");
    expect(f.origin_slug).toBe("tlc191");
    expect(f.inherited).toBe(false);
  });

  /** The whole reason profile_id exists: a template beats the place. */
  it("prefers the profile over the parent", async () => {
    const customerId = await estate();
    await fact(null, "coding_mode", "CUSTOMER");
    await fact("cantabria", "coding_mode", "SITE");
    await fact("layout-3", "coding_mode", "LAYOUT");

    const f = byKind(
      await resolveUnitFacts((await resolveUnit(customerId, "tlc191")).id),
      "coding_mode",
    );
    expect(f.value).toBe("LAYOUT");
    expect(f.origin_slug).toBe("layout-3");
    expect(f.origin_kind).toBe("layout");
    expect(f.inherited).toBe(true);
  });

  it("falls through the parent to the customer", async () => {
    const customerId = await estate();
    await fact(null, "coding_mode", "CUSTOMER");
    await fact("cantabria", "timezone", "Europe/Madrid");

    const facts = await resolveUnitFacts(
      (await resolveUnit(customerId, "tpc141")).id,
    );
    expect(byKind(facts, "coding_mode")).toMatchObject({
      value: "CUSTOMER",
      origin_slug: null,
      inherited: true,
    });
    expect(byKind(facts, "timezone")).toMatchObject({
      value: "Europe/Madrid",
      origin_slug: "cantabria",
    });
  });

  it("skips the profile rung for a line that has none", async () => {
    const customerId = await estate();
    await fact("layout-3", "coding_mode", "LAYOUT");
    await fact("cantabria", "coding_mode", "SITE");

    // tpc141 has no profile, so the layout's fact must not reach it.
    const f = byKind(
      await resolveUnitFacts((await resolveUnit(customerId, "tpc141")).id),
      "coding_mode",
    );
    expect(f.value).toBe("SITE");
  });

  it("does not leak a sibling's facts", async () => {
    const customerId = await estate();
    await fact("tlc192", "ip", "10.4.12.32", "plc");
    const facts = await resolveUnitFacts(
      (await resolveUnit(customerId, "tlc191")).id,
    );
    expect(facts.find((f) => f.kind === "ip")).toBeUndefined();
  });

  it("keeps facts of the same kind apart by label", async () => {
    const customerId = await estate();
    await fact("tlc191", "ip", "10.4.12.31", "plc");
    await fact("tlc191", "ip", "10.4.12.32", "scada");
    const ips = (
      await resolveUnitFacts((await resolveUnit(customerId, "tlc191")).id)
    ).filter((f) => f.kind === "ip");
    expect(ips.map((f) => [f.label, f.value]).sort()).toEqual([
      ["plc", "10.4.12.31"],
      ["scada", "10.4.12.32"],
    ]);
  });

  it("upserts a customer-level fact in place rather than duplicating it", async () => {
    await estate();
    await fact(null, "version", "4.2.0", "tpd");
    await fact(null, "version", "4.2.1", "tpd");
    const [{ count }] =
      await sql`select count(*)::int as count from customer_facts where kind = 'version'`;
    expect(count).toBe(1);
  });

  it("lets a unit-level fact coexist with the customer-level one", async () => {
    const customerId = await estate();
    await fact(null, "version", "4.2.0", "tpd");
    await fact("tlc191", "version", "4.3.0", "tpd");
    const [{ count }] =
      await sql`select count(*)::int as count from customer_facts where kind = 'version'`;
    expect(count).toBe(2);
    expect(
      byKind(
        await resolveUnitFacts((await resolveUnit(customerId, "tlc191")).id),
        "version",
      ).value,
    ).toBe("4.3.0");
  });
});

describe("unit-aware search", () => {
  beforeEach(resetData);

  const entry = async (unit: string | null, summary: string) => {
    const customerId = await getCustomerIdBySlug("itg");
    const row = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      customerSlug: "itg",
      issueSummary: summary,
      resolution: "spooler queue overruns on the labeller",
    });
    if (unit)
      await sql`update knowledge_entries set customer_unit_id =
                (select id from customer_units where customer_id = ${customerId} and slug = ${unit})
                where id = ${row.id}`;
    return row;
  };

  /**
   * The TLC191/192 case: a lesson from a sibling on the same layout should
   * outrank one from a line on a different layout, without either being hidden.
   */
  it("lifts the unit's own entries above a sibling's, and a sibling's above an unrelated line's", async () => {
    const customerId = await estate();
    const own = await entry("tlc191", "spooler queue overrun on the labeller");
    const sibling = await entry(
      "tlc192",
      "spooler queue overrun on the labeller",
    );
    const other = await entry(
      "tpc141",
      "spooler queue overrun on the labeller",
    );

    const unitId = (await resolveUnit(customerId, "tlc191")).id;
    const hits = await searchKnowledge("spooler queue overrun labeller", {
      boostCustomerId: customerId,
      boostUnitId: unitId,
      limit: 10,
    });
    const order = hits.map((h: any) => h.id);
    expect(order.indexOf(own.id)).toBeLessThan(order.indexOf(sibling.id));
    expect(order.indexOf(sibling.id)).toBeLessThan(order.indexOf(other.id));
    // Boost, never exclude.
    expect(order).toContain(other.id);
  });

  it("changes nothing when no unit is given", async () => {
    const customerId = await estate();
    await entry("tlc191", "spooler queue overrun on the labeller");
    await entry("tpc141", "spooler queue overrun on the labeller");
    const hits = await searchKnowledge("spooler queue overrun labeller", {
      boostCustomerId: customerId,
      limit: 10,
    });
    expect(hits).toHaveLength(2);
  });
});

describe("unit attribution on tickets and entries", () => {
  beforeEach(resetData);

  /** A ticket to hang attribution off, in the seeded freshdesk fixture. */
  async function ticket() {
    const [row] = await sql`
      insert into work_items (source_connection_id, external_id, kind, title, product_id)
      select sc.id, 'wi-1', 'ticket', 'spooler stalls', p.id
      from source_connections sc, products p
      where sc.slug = 'test-freshdesk' and p.slug = 'tpd'
      returning id
    `;
    return row.id as string;
  }

  it("records a unit on a ticket, and clears it with the customer", async () => {
    const customerId = await estate();
    const id = await ticket();

    await setWorkItemCustomer(id, customerId, "tlc191");
    const [withUnit] =
      await sql`select customer_id, customer_unit_id from work_items where id = ${id}`;
    expect(withUnit.customer_id).toBe(customerId);
    expect(withUnit.customer_unit_id).not.toBeNull();

    // A unit belongs to a customer; clearing one must not orphan the other.
    await setWorkItemCustomer(id, null);
    const [cleared] =
      await sql`select customer_id, customer_unit_id from work_items where id = ${id}`;
    expect(cleared.customer_id).toBeNull();
    expect(cleared.customer_unit_id).toBeNull();
  });

  it("refuses a unit belonging to a different customer", async () => {
    await estate();
    await addCustomer({ name: "Other", slug: "other" });
    const otherId = await getCustomerIdBySlug("other");
    const id = await ticket();
    await expect(setWorkItemCustomer(id, otherId, "tlc191")).rejects.toThrow(
      /Unknown unit/,
    );
  });

  /**
   * The rule: whose ticket it was is a fact, whose behaviour it describes is a
   * judgement. Once the judgement is stated, narrowing it to the line the ticket
   * already named adds nothing new.
   */
  it("inherits the ticket's unit once the customer is stated and matches", async () => {
    const customerId = await estate();
    const id = await ticket();
    await setWorkItemCustomer(id, customerId, "tlc191");

    const entry = await saveKnowledgeEntry({
      workItemId: id,
      customerSlug: "itg",
      issueSummary: "learned here",
    });
    const [row] =
      await sql`select customer_unit_id from knowledge_entries where id = ${entry.id}`;
    expect(row.customer_unit_id).toBe(
      (await resolveUnit(customerId, "tlc191")).id,
    );
  });

  it("inherits nothing when no customer is stated", async () => {
    const customerId = await estate();
    const id = await ticket();
    await setWorkItemCustomer(id, customerId, "tlc191");

    const entry = await saveKnowledgeEntry({
      workItemId: id,
      issueSummary: "general lesson",
    });
    const [row] =
      await sql`select customer_id, customer_unit_id from knowledge_entries where id = ${entry.id}`;
    expect(row.customer_id).toBeNull();
    expect(row.customer_unit_id).toBeNull();
  });

  it("inherits nothing when a different customer is stated", async () => {
    const customerId = await estate();
    await addCustomer({ name: "Other", slug: "other" });
    const id = await ticket();
    await setWorkItemCustomer(id, customerId, "tlc191");

    const entry = await saveKnowledgeEntry({
      workItemId: id,
      customerSlug: "other",
      issueSummary: "about someone else",
    });
    const [row] =
      await sql`select customer_unit_id from knowledge_entries where id = ${entry.id}`;
    expect(row.customer_unit_id).toBeNull();
  });

  it("takes an explicit unit, and refuses one without a customer", async () => {
    const customerId = await estate();
    const entry = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      customerSlug: "itg",
      unit: "tlc191",
      issueSummary: "stated directly",
    });
    const [row] =
      await sql`select customer_unit_id from knowledge_entries where id = ${entry.id}`;
    expect(row.customer_unit_id).toBe(
      (await resolveUnit(customerId, "tlc191")).id,
    );

    await expect(
      saveKnowledgeEntry({
        productId: await tpdProductId(),
        unit: "tlc191",
        issueSummary: "no customer",
      }),
    ).rejects.toThrow(/needs its customer/);
  });

  it("drops the unit when an entry is re-filed under another customer", async () => {
    await estate();
    await addCustomer({ name: "Other", slug: "other" });
    const entry = await saveKnowledgeEntry({
      productId: await tpdProductId(),
      customerSlug: "itg",
      unit: "tlc191",
      issueSummary: "x",
    });
    await updateKnowledgeEntry(entry.id, { customerSlug: "other" });
    const [row] =
      await sql`select customer_unit_id from knowledge_entries where id = ${entry.id}`;
    expect(row.customer_unit_id).toBeNull();
  });

  it("tags a reference doc with a unit too", async () => {
    const customerId = await estate();
    const doc = await saveReferenceDoc({
      productId: await tpdProductId(),
      customerSlug: "itg",
      unit: "tlc191",
      title: "TLC191 runbook",
      body: "steps",
    });
    const [row] =
      await sql`select customer_unit_id from reference_docs where id = ${doc.id}`;
    expect(row.customer_unit_id).toBe(
      (await resolveUnit(customerId, "tlc191")).id,
    );
  });
});

describe("setting a work item's customer and its unit", () => {
  it("leaves the unit alone when the body does not mention it", async () => {
    const customer = await addCustomer({ slug: "wu-acme", name: "WU Acme" });
    await addCustomerUnit({
      customerSlug: "wu-acme",
      slug: "line-1",
      kind: "line",
      name: "Line 1",
    });
    const [conn] = await sql`
      insert into source_connections (slug, source_type, base_url)
      values ('wu-fd', 'freshdesk', 'https://example.invalid')
      on conflict (slug) do update set base_url = excluded.base_url
      returning id
    `;
    const [item] = await sql`
      insert into work_items (source_connection_id, external_id, title)
      values (${conn.id}, 'wu-1', 'ticket') returning id
    `;

    await setWorkItemCustomer(item.id, customer.id, "line-1");
    const unitId = (
      await sql`select customer_unit_id from work_items where id = ${item.id}`
    )[0].customer_unit_id;
    expect(unitId).not.toBeNull();

    // Re-attributing to the same customer with no unit in the body must not
    // discard which line it was narrowed to.
    await setWorkItemCustomer(item.id, customer.id);
    expect(
      (
        await sql`select customer_unit_id from work_items where id = ${item.id}`
      )[0].customer_unit_id,
    ).toBe(unitId);

    // An explicit null still clears it.
    await setWorkItemCustomer(item.id, customer.id, null);
    expect(
      (
        await sql`select customer_unit_id from work_items where id = ${item.id}`
      )[0].customer_unit_id,
    ).toBeNull();
  });

  it("clears the unit when the customer changes or is removed", async () => {
    const a = await addCustomer({ slug: "wu-a", name: "A" });
    const b = await addCustomer({ slug: "wu-b", name: "B" });
    await addCustomerUnit({
      customerSlug: "wu-a",
      slug: "l1",
      kind: "line",
      name: "L1",
    });
    const [conn] =
      await sql`select id from source_connections where slug = 'wu-fd'`;
    const [item] = await sql`
      insert into work_items (source_connection_id, external_id, title)
      values (${conn.id}, 'wu-2', 'ticket') returning id
    `;

    await setWorkItemCustomer(item.id, a.id, "l1");
    // A unit belongs to one customer, so it cannot follow the ticket across.
    await setWorkItemCustomer(item.id, b.id);
    expect(
      (
        await sql`select customer_unit_id from work_items where id = ${item.id}`
      )[0].customer_unit_id,
    ).toBeNull();
  });
});
