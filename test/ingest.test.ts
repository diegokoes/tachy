import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ingestWorkItem, addCustomer, setWorkItemCustomer } from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";
import { resetData, seededFreshdeskConnId, sql, tpdProductId } from "./helpers";

// File scope: a later describe would otherwise run against a closed pool.
afterAll(() => sql.end());

function rawItem(over: Partial<RawWorkItem> = {}): RawWorkItem {
  return {
    externalId: "58925",
    kind: "ticket",
    title: "Scanner offline",
    status: "2",
    groupKey: "48000641379",
    raw: { id: 58925 },
    messages: [],
    ...over,
  };
}

describe("ingestWorkItem", () => {
  beforeEach(resetData);

  it("resolves product/team from the seeded group mapping", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(connId, rawItem());
    expect(item.productId).toBe(await tpdProductId());
    expect(item.teamId).not.toBeNull();
  });

  it("upserts on (source, external_id) and refreshes mutable fields", async () => {
    const connId = await seededFreshdeskConnId();
    const first = await ingestWorkItem(connId, rawItem({ title: "old" }));
    const second = await ingestWorkItem(connId, rawItem({ title: "new" }));
    expect(second.id).toBe(first.id);
    const [row] =
      await sql`select title from work_items where id = ${first.id}`;
    expect(row.title).toBe("new");
  });

  it("stores messages and dedupes by external_id", async () => {
    const connId = await seededFreshdeskConnId();
    const msg = {
      externalId: "m1",
      visibility: "public" as const,
      direction: "incoming" as const,
      bodyText: "hello",
    };
    const item = await ingestWorkItem(connId, rawItem({ messages: [msg] }));
    await ingestWorkItem(connId, rawItem({ messages: [msg] }));
    const rows =
      await sql`select count(*)::int as n from work_item_messages where work_item_id = ${item.id}`;
    expect(rows[0].n).toBe(1);
  });

  it("auto-matches a customer by requester email domain, including a partner's", async () => {
    const connId = await seededFreshdeskConnId();
    const customer = await addCustomer({
      name: "Davidoff",
      slug: "davidoff",
      emailDomains: ["davidoff.com", "arvato.com"],
    });

    const direct = await ingestWorkItem(
      connId,
      rawItem({ externalId: "1", requesterEmail: "user@davidoff.com" }),
    );
    expect(direct.customerId).toBe(customer.id);

    const viaDistributor = await ingestWorkItem(
      connId,
      rawItem({ externalId: "2", requesterEmail: "agent@arvato.com" }),
    );
    expect(viaDistributor.customerId).toBe(customer.id);

    const unmatched = await ingestWorkItem(
      connId,
      rawItem({ externalId: "3", requesterEmail: "user@other.com" }),
    );
    expect(unmatched.customerId).toBeNull();
  });

  it("never overwrites a manually corrected customer on re-sync", async () => {
    const connId = await seededFreshdeskConnId();
    const wrong = await addCustomer({
      name: "Wrong Co",
      slug: "wrong-co",
      emailDomains: ["shared.example"],
    });
    const right = await addCustomer({ name: "Right Co", slug: "right-co" });

    const first = await ingestWorkItem(
      connId,
      rawItem({ requesterEmail: "agent@shared.example" }),
    );
    expect(first.customerId).toBe(wrong.id);

    await setWorkItemCustomer(first.id, right.id);
    const resynced = await ingestWorkItem(
      connId,
      rawItem({ requesterEmail: "agent@shared.example", title: "updated" }),
    );
    expect(resynced.customerId).toBe(right.id);
  });
});

describe("customer attribution precedence", () => {
  beforeEach(resetData);

  /** A project that exists for one customer, plus a domain pointing elsewhere. */
  async function setup() {
    const connId = await seededFreshdeskConnId();
    const knauf = await addCustomer({
      name: "Knauf",
      slug: "knauf",
      emailDomains: ["knauf.com"],
    });
    await addCustomer({
      name: "Logista",
      slug: "logista",
      emailDomains: ["logista.com"],
    });
    await sql`
      update source_projects set customer_id = ${knauf.id}
      where external_key = '48000641379'
    `;
    return { connId, knaufId: knauf.id as string };
  }

  it("a single-customer project decides, even when no domain matches", async () => {
    const { connId, knaufId } = await setup();
    const item = await ingestWorkItem(connId, {
      ...rawItem(),
      requesterEmail: "someone@gmail.com",
    });
    expect(item.customerId).toBe(knaufId);
    expect(item.customerAmbiguity).toBeUndefined();
  });

  it("the project beats a domain that disagrees, and says so", async () => {
    const { connId, knaufId } = await setup();
    const item = await ingestWorkItem(connId, {
      ...rawItem(),
      requesterEmail: "buyer@logista.com",
    });
    expect(item.customerId).toBe(knaufId);
    expect(item.customerAmbiguity).toMatch(
      /different customer than the project/,
    );
  });

  it("with no project customer, the sender's domain still decides", async () => {
    const connId = await seededFreshdeskConnId();
    const logista = await addCustomer({
      name: "Logista",
      slug: "logista",
      emailDomains: ["logista.com"],
    });
    const item = await ingestWorkItem(connId, {
      ...rawItem(),
      requesterEmail: "buyer@logista.com",
    });
    expect(item.customerId).toBe(logista.id);
  });
});
