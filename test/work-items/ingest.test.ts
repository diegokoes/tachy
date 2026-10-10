import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ingestWorkItem, messageKey } from "@tachy/core/work-items";
import { addCustomer, setWorkItemCustomer } from "@tachy/core/catalog";
import type { RawMessage, RawWorkItem } from "@tachy/core/sources";
import {
  resetData,
  seededFreshdeskConnId,
  sql,
  tpdProductId,
} from "../database";

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
    expect(item.customerAmbiguity).toMatch(/map to different customers/);
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

describe("one stored copy of each message", () => {
  beforeEach(resetData);

  const message = (over: Partial<RawMessage> = {}): RawMessage => ({
    externalId: "m1",
    author: "alice",
    visibility: "public",
    direction: "incoming",
    bodyText: "it broke",
    createdAt: "2026-04-01T10:00:00Z",
    ...over,
  });
  const stored = (itemId: string) => sql<
    { external_id: string; body_text: string }[]
  >`
    select external_id, body_text from work_item_messages
    where work_item_id = ${itemId} order by external_id
  `;

  it("keeps one row for a message the source gives no id for, however often it is fetched", async () => {
    const connId = await seededFreshdeskConnId();
    const unnamed = message({ externalId: undefined });
    const item = await ingestWorkItem(connId, rawItem({ messages: [unnamed] }));
    await ingestWorkItem(connId, rawItem({ messages: [unnamed] }));
    await ingestWorkItem(connId, rawItem({ messages: [unnamed] }));

    const rows = await stored(item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe(messageKey(unnamed));
    expect(rows[0].external_id).toMatch(/^h-[0-9a-f]{32}$/);
  });

  it("tells two messages without ids apart by who wrote them, when and what", () => {
    const first = message({ externalId: undefined });
    expect(messageKey(first)).toBe(messageKey({ ...first }));
    expect(messageKey(first)).not.toBe(
      messageKey({ ...first, bodyText: "it broke again" }),
    );
    expect(messageKey(first)).not.toBe(messageKey({ ...first, author: "bob" }));
    expect(messageKey(message())).toBe("m1");
  });

  it("stores one row when a fetch carries the same message twice", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ messages: [message(), message({ bodyText: "edited" })] }),
    );
    expect(await stored(item.id)).toEqual([
      { external_id: "m1", body_text: "edited" },
    ]);
  });

  it("drops a stored message the source no longer has", async () => {
    const connId = await seededFreshdeskConnId();
    const summary = message({ externalId: "note-1", bodyText: "summary v1" });
    const item = await ingestWorkItem(
      connId,
      rawItem({ messages: [message(), summary] }),
    );
    // The note was replaced at the source: the old one is gone, a new one is there.
    await ingestWorkItem(
      connId,
      rawItem({
        messages: [
          message(),
          message({ externalId: "note-2", bodyText: "summary v2" }),
        ],
      }),
    );
    expect(await stored(item.id)).toEqual([
      { external_id: "m1", body_text: "it broke" },
      { external_id: "note-2", body_text: "summary v2" },
    ]);
  });

  it("clears a message stored without an id on the next full fetch", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ messages: [message()] }),
    );
    await sql`
      insert into work_item_messages (work_item_id, external_id, body_text)
      values (${item.id}, null, 'a copy from before messages were keyed')
    `;
    await ingestWorkItem(connId, rawItem({ messages: [message()] }));
    expect(await stored(item.id)).toEqual([
      { external_id: "m1", body_text: "it broke" },
    ]);
  });

  it("leaves the stored messages alone when a sync brings the ticket without any", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ messages: [message()] }),
    );
    await ingestWorkItem(connId, rawItem({ title: "renamed", messages: [] }));
    expect(await stored(item.id)).toHaveLength(1);
  });
});
