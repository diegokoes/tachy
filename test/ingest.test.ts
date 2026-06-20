import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ingestWorkItem, addCustomer, setWorkItemCustomer } from "@tachy/core";
import type { RawWorkItem } from "@tachy/core";
import { resetData, seededFreshdeskConnId, sql, tpdProductId } from "./helpers";

function rawItem(over: Partial<RawWorkItem> = {}): RawWorkItem {
  return {
    externalId: "58925",
    kind: "ticket",
    title: "Scanner offline",
    status: "2",
    groupKey: "48000641379", // seeded -> tpd
    raw: { id: 58925 },
    messages: [],
    ...over,
  };
}

describe("ingestWorkItem", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

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
    const [row] = await sql`select title from work_items where id = ${first.id}`;
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
    const rows = await sql`select count(*)::int as n from work_item_messages where work_item_id = ${item.id}`;
    expect(rows[0].n).toBe(1);
  });

  it("auto-matches a customer by requester email domain, including aliases", async () => {
    const connId = await seededFreshdeskConnId();
    const customer = await addCustomer({ name: "Davidoff", slug: "davidoff", aliases: ["davidoff.com", "arvato.com"] });

    const direct = await ingestWorkItem(connId, rawItem({ externalId: "1", requesterEmail: "user@davidoff.com" }));
    expect(direct.customerId).toBe(customer.id);

    const viaDistributor = await ingestWorkItem(connId, rawItem({ externalId: "2", requesterEmail: "agent@arvato.com" }));
    expect(viaDistributor.customerId).toBe(customer.id);

    const unmatched = await ingestWorkItem(connId, rawItem({ externalId: "3", requesterEmail: "user@other.com" }));
    expect(unmatched.customerId).toBeNull();
  });

  it("never overwrites a manually corrected customer on re-sync", async () => {
    const connId = await seededFreshdeskConnId();
    const wrong = await addCustomer({ name: "Wrong Co", slug: "wrong-co", aliases: ["shared.example"] });
    const right = await addCustomer({ name: "Right Co", slug: "right-co" });

    const first = await ingestWorkItem(connId, rawItem({ requesterEmail: "agent@shared.example" }));
    expect(first.customerId).toBe(wrong.id);

    await setWorkItemCustomer(first.id, right.id);
    const resynced = await ingestWorkItem(connId, rawItem({ requesterEmail: "agent@shared.example", title: "updated" }));
    expect(resynced.customerId).toBe(right.id);
  });
});
