import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addComponent,
  addCustomer,
  addCustomerUnit,
  batchScope,
  deleteCustomer,
  deleteCustomerFact,
  deleteCustomerUnit,
  getCustomerIdBySlug,
  linkCustomerComponent,
  listCustomerChanges,
  listCustomerFacts,
  listCustomerUnits,
  listDeletedCustomers,
  restoreCustomerBatch,
  setCustomerFact,
  updateCustomer,
} from "@tachy/core/catalog";
import { createUser } from "@tachy/core/access";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { resetData, sql, tqxProductId } from "../database";

afterAll(() => sql.end());

/** A site holding a line that follows a layout, with facts on each level. */
async function buildSetup() {
  const productId = await tqxProductId();
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
  await addCustomerUnit({
    customerSlug: "ivk",
    slug: "pln192",
    name: "PLN192",
    kind: "line",
    productId,
    parentSlug: "calderra",
  });
  await setCustomerFact({
    customerSlug: "ivk",
    unit: "calderra",
    kind: "timezone",
    value: "Europe/Madrid",
  });
  await setCustomerFact({
    customerSlug: "ivk",
    unit: "pln191",
    kind: "ip",
    label: "plc",
    value: "10.4.12.31",
  });
  return getCustomerIdBySlug("ivk");
}

const latestBatch = async (customerId: string) =>
  (await listCustomerChanges(customerId))[0];

const factValues = async (customerId: string) =>
  (await listCustomerFacts(customerId)).map(
    (f) => `${f.unit_slug ?? "-"}:${f.kind}:${f.value}`,
  );

describe("what a customer's history records", () => {
  beforeEach(resetData);

  it("keeps each write as a batch with the rows before and after, newest first", async () => {
    const customerId = await buildSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "calderra",
      kind: "timezone",
      value: "Europe/Lisbon",
    });
    const [latest] = await listCustomerChanges(customerId);
    expect(latest.changes).toHaveLength(1);
    const [change] = latest.changes;
    expect(change.record).toBe("fact");
    expect(change.before?.value).toBe("Europe/Madrid");
    expect(change.after?.value).toBe("Europe/Lisbon");
  });

  it("records who made a change and through which door", async () => {
    const user = await createUser({
      email: "lead@example.com",
      role: "member",
    });
    await addCustomer(
      { name: "Losvane", slug: "losvane" },
      { userId: user.id, actor: "agent", turnId: "turn-1" },
    );
    const [batch] = await listCustomerChanges(
      await getCustomerIdBySlug("losvane"),
    );
    expect(batch).toMatchObject({
      actor: "agent",
      user_email: "lead@example.com",
    });
    const [row] = await sql`select turn_id from customer_changes`;
    expect(row.turn_id).toBe("turn-1");
  });

  it("records nothing for a write that changes nothing", async () => {
    const customerId = await buildSetup();
    const before = (await listCustomerChanges(customerId)).length;
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "calderra",
      kind: "timezone",
      value: "Europe/Madrid",
    });
    expect(await listCustomerChanges(customerId)).toHaveLength(before);
  });

  it("puts a product link a unit implies in the unit's own batch", async () => {
    await addCustomer({ name: "Losvane", slug: "losvane" });
    await addCustomerUnit({
      customerSlug: "losvane",
      slug: "madrid",
      name: "Madrid",
      kind: "site",
      productId: await tqxProductId(),
    });
    const batch = await latestBatch(await getCustomerIdBySlug("losvane"));
    expect(batch.changes.map((c) => c.record)).toEqual(["unit", "product"]);
  });

  it("names the products and the customer a restore needs the rights of", async () => {
    const customerId = await buildSetup();
    const productId = await tqxProductId();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "pln191",
      kind: "ip",
      label: "plc",
      value: "10.4.12.99",
    });
    expect(
      await batchScope((await latestBatch(customerId)).batch_id),
    ).toEqual({ customerId, productIds: [productId], touchesCustomer: false });
    await updateCustomer("ivk", { notes: "pilot" });
    expect(
      await batchScope((await latestBatch(customerId)).batch_id),
    ).toMatchObject({ productIds: [], touchesCustomer: true });
  });
});

describe("restoring a batch", () => {
  beforeEach(resetData);

  it("puts back a value the batch overwrote, as a batch of its own", async () => {
    const customerId = await buildSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "pln191",
      kind: "ip",
      label: "plc",
      value: "10.4.12.99",
    });
    const overwrite = await latestBatch(customerId);
    await restoreCustomerBatch(overwrite.batch_id);
    expect(await factValues(customerId)).toContain("pln191:ip:10.4.12.31");
    expect((await latestBatch(customerId)).restores).toBe(overwrite.batch_id);
  });

  it("brings back a deleted fact", async () => {
    const customerId = await buildSetup();
    const [fact] = await listCustomerFacts(customerId);
    await deleteCustomerFact(customerId, fact.id);
    await restoreCustomerBatch((await latestBatch(customerId)).batch_id);
    expect(await factValues(customerId)).toHaveLength(2);
  });

  it("brings back a deleted unit with its facts, its children and its followers", async () => {
    const customerId = await buildSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "layout-3",
      kind: "coding_mode",
      value: "CT2",
    });
    await deleteCustomerUnit(customerId, "calderra");
    await deleteCustomerUnit(customerId, "layout-3");
    await restoreCustomerBatch((await latestBatch(customerId)).batch_id);
    await restoreCustomerBatch(
      (await listCustomerChanges(customerId)).find(
        (b) =>
          !b.restores &&
          b.changes.some(
            (c) => c.record === "unit" && c.before?.slug === "calderra",
          ),
      )!.batch_id,
    );
    const units = await listCustomerUnits(customerId);
    const bySlug = new Map(units.map((u) => [u.slug, u]));
    expect(bySlug.get("pln191")!.parent_id).toBe(bySlug.get("calderra")!.id);
    expect(bySlug.get("pln191")!.template_id).toBe(
      bySlug.get("layout-3")!.id,
    );
    expect(await factValues(customerId)).toEqual(
      expect.arrayContaining([
        "calderra:timezone:Europe/Madrid",
        "layout-3:coding_mode:CT2",
      ]),
    );
  });

  it("brings back a deleted customer with its setup, facts and links", async () => {
    const customerId = await buildSetup();
    const productId = await tqxProductId();
    await addComponent({ productId, slug: "printer", name: "Printer" });
    await linkCustomerComponent("ivk", productId, "printer");
    await deleteCustomer("ivk");
    const [deleted] = await listDeletedCustomers();
    expect(deleted).toMatchObject({ slug: "ivk", name: "Ilverton Brands" });

    await restoreCustomerBatch(deleted.batch_id);
    expect(await getCustomerIdBySlug("ivk")).toBe(customerId);
    const units = await listCustomerUnits(customerId);
    const line = units.find((u) => u.slug === "pln191")!;
    expect(line.parent_id).toBe(units.find((u) => u.slug === "calderra")!.id);
    expect(line.template_id).toBe(
      units.find((u) => u.slug === "layout-3")!.id,
    );
    expect(await factValues(customerId)).toHaveLength(2);
    const [links] = await sql`
      select (select count(*)::int from customer_products) as products,
             (select count(*)::int from customer_components) as components
    `;
    expect(links).toEqual({ products: 1, components: 1 });
    expect(await listDeletedCustomers()).toEqual([]);
  });

  it("refuses when a record of the batch changed since, and takes the newer one first", async () => {
    const customerId = await buildSetup();
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "calderra",
      kind: "timezone",
      value: "Europe/Lisbon",
    });
    const first = await latestBatch(customerId);
    await setCustomerFact({
      customerSlug: "ivk",
      unit: "calderra",
      kind: "timezone",
      value: "Europe/Paris",
    });
    const second = await latestBatch(customerId);
    await expect(restoreCustomerBatch(first.batch_id)).rejects.toThrow(
      /changed again.*restore the newer change first/,
    );
    await restoreCustomerBatch(second.batch_id);
    await restoreCustomerBatch(first.batch_id);
    expect(await factValues(customerId)).toContain(
      "calderra:timezone:Europe/Madrid",
    );
  });

  it("will not undo adding a unit that has gained a fact or an entry since", async () => {
    const customerId = await buildSetup();
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "tpc141",
      name: "TPC141",
      kind: "line",
    });
    const added = await latestBatch(customerId);
    await saveKnowledgeEntry({
      productId: await tqxProductId(),
      title: "Printer stops on TPC141",
      issueSummary: "The printer stops mid-batch.",
      customerSlug: "ivk",
      unit: "tpc141",
      status: "approved",
    });
    await expect(restoreCustomerBatch(added.batch_id)).rejects.toThrow(
      /more under it since it was added/,
    );
  });

  it("will not undo the same batch twice", async () => {
    const customerId = await buildSetup();
    await updateCustomer("ivk", { notes: "pilot" });
    const edit = await latestBatch(customerId);
    await restoreCustomerBatch(edit.batch_id);
    await expect(restoreCustomerBatch(edit.batch_id)).rejects.toThrow(
      /changed again/,
    );
  });

  it("does not know a batch nobody wrote", async () => {
    await expect(
      restoreCustomerBatch("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/not found/);
  });
});
