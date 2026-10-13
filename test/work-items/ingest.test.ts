import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ingestWorkItem, messageKey } from "@tachy/core/work-items";
import { addCustomer, setWorkItemCustomer } from "@tachy/core/catalog";
import type { RawEvent, RawMessage, RawWorkItem } from "@tachy/core/sources";
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
    await ingestWorkItem(
      connId,
      rawItem({ title: "renamed", listed: true, messages: [] }),
    );
    expect(await stored(item.id)).toHaveLength(1);
  });

  it("clears the stored messages when a fetch finds the item has none left", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ messages: [message()] }),
    );
    await ingestWorkItem(connId, rawItem({ messages: [] }));
    expect(await stored(item.id)).toEqual([]);
  });

  it("keeps who sent a message and whether a machine wrote it", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({
        messages: [
          message({ author: "42", authorLabel: "jane@acme.com" }),
          message({
            externalId: "m2",
            authorLabel: "support (automated)",
            automated: true,
          }),
        ],
      }),
    );
    expect(
      await sql`
        select external_id, author, author_label, automated
        from work_item_messages where work_item_id = ${item.id} order by external_id
      `,
    ).toEqual([
      {
        external_id: "m1",
        author: "42",
        author_label: "jane@acme.com",
        automated: false,
      },
      {
        external_id: "m2",
        author: "alice",
        author_label: "support (automated)",
        automated: true,
      },
    ]);
  });

  it("follows a note that was made public at the source", async () => {
    const connId = await seededFreshdeskConnId();
    const note = message({ visibility: "private", direction: "outgoing" });
    const item = await ingestWorkItem(connId, rawItem({ messages: [note] }));
    await ingestWorkItem(
      connId,
      rawItem({ messages: [{ ...note, visibility: "public" }] }),
    );
    expect(
      await sql`
        select visibility, direction from work_item_messages
        where work_item_id = ${item.id}
      `,
    ).toEqual([{ visibility: "public", direction: "outgoing" }]);
  });
});

describe("a listing over a stored copy", () => {
  beforeEach(resetData);

  const row = async (itemId: string) => {
    const [stored] = await sql`
      select title, status, external_group_key, requester, assignee, priority,
             item_type, raw, fetched_at, source_created_at
      from work_items where id = ${itemId}
    `;
    return stored;
  };

  it("lays its fields over the payload a fetch stored, and keeps what only a fetch returns", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({
        raw: {
          id: 58925,
          status: 2,
          description_text: "the scanner is offline",
          requester: { email: "jane@acme.com" },
        },
        messages: [
          {
            externalId: "desc-58925",
            visibility: "public",
            direction: "incoming",
            bodyText: "the scanner is offline",
          },
        ],
      }),
    );
    const fetched = await row(item.id);

    await ingestWorkItem(
      connId,
      rawItem({
        status: "4",
        listed: true,
        raw: { id: 58925, status: 4, stats: { resolved_at: "2026-04-02" } },
      }),
    );
    const listed = await row(item.id);
    expect(listed.status).toBe("4");
    expect(listed.raw).toEqual({
      id: 58925,
      status: 4,
      stats: { resolved_at: "2026-04-02" },
      description_text: "the scanner is offline",
      requester: { email: "jane@acme.com" },
    });
    expect(listed.fetched_at).toEqual(fetched.fetched_at);
  });

  it("replaces the payload on a fetch, so a field the source dropped goes", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ raw: { id: 58925, due_by: "2026-04-03" } }),
    );
    await ingestWorkItem(connId, rawItem({ raw: { id: 58925 } }));
    expect((await row(item.id)).raw).toEqual({ id: 58925 });
  });

  it("leaves an item only a listing carried marked as never fetched", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(connId, rawItem({ listed: true }));
    expect((await row(item.id)).fetched_at).toBeNull();

    await ingestWorkItem(connId, rawItem());
    expect((await row(item.id)).fetched_at).toBeInstanceOf(Date);
  });

  it("follows the source when a ticket moves group, owner, priority or type", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({
        requester: "42",
        assignee: "7",
        priority: "1",
        itemType: "Question",
        sourceCreatedAt: "2026-04-01T10:00:00Z",
      }),
    );
    await ingestWorkItem(
      connId,
      rawItem({
        groupKey: "999",
        requester: "43",
        assignee: "8",
        priority: "4",
        itemType: "Incident",
        listed: true,
      }),
    );
    expect(await row(item.id)).toMatchObject({
      external_group_key: "999",
      requester: "43",
      assignee: "8",
      priority: "4",
      item_type: "Incident",
      source_created_at: new Date("2026-04-01T10:00:00Z"),
    });
  });
});

describe("an item's events", () => {
  beforeEach(resetData);

  const events = (itemId: string) => sql<
    {
      external_id: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      actor: string | null;
      origin: string;
      occurred_at: Date;
    }[]
  >`
    select external_id, field, old_value, new_value, actor, origin, occurred_at
    from work_item_events where work_item_id = ${itemId}
    order by occurred_at, external_id
  `;
  const resolved = (at: string): RawEvent => ({
    externalId: `stats:resolved_at:${at}`,
    occurredAt: at,
    field: "resolved",
  });

  it("keeps what the source says happened, once however often it is read", async () => {
    const connId = await seededFreshdeskConnId();
    const read = rawItem({
      events: [
        {
          externalId: "created",
          occurredAt: "2026-04-01T10:00:00Z",
          field: "created",
        },
        resolved("2026-04-02T09:00:00Z"),
      ],
    });
    const item = await ingestWorkItem(connId, read);
    await ingestWorkItem(connId, read);
    expect(await events(item.id)).toMatchObject([
      { field: "created", origin: "source", old_value: null, new_value: null },
      {
        field: "resolved",
        origin: "source",
        occurred_at: new Date("2026-04-02T09:00:00Z"),
      },
    ]);
  });

  it("keeps the first resolution when a ticket is resolved again", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ events: [resolved("2026-04-02T09:00:00Z")] }),
    );
    await ingestWorkItem(
      connId,
      rawItem({ listed: true, events: [resolved("2026-04-09T15:00:00Z")] }),
    );
    expect((await events(item.id)).map((e) => e.occurred_at)).toEqual([
      new Date("2026-04-02T09:00:00Z"),
      new Date("2026-04-09T15:00:00Z"),
    ]);
  });

  it("leaves out an event the source did not date", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({
        events: [{ externalId: "x", occurredAt: "soon", field: "closed" }],
      }),
    );
    expect(await events(item.id)).toEqual([]);
  });

  it("records what differs between two reads, at the time the source last changed", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ assignee: "7", sourceUpdatedAt: "2026-04-01T10:00:00Z" }),
    );
    expect(await events(item.id)).toEqual([]);

    await ingestWorkItem(
      connId,
      rawItem({
        status: "4",
        assignee: undefined,
        listed: true,
        sourceUpdatedAt: "2026-04-03T08:30:00Z",
      }),
    );
    expect(await events(item.id)).toEqual([
      {
        external_id: "observed:assignee:2026-04-03T08:30:00.000Z",
        field: "assignee",
        old_value: "7",
        new_value: null,
        actor: null,
        origin: "observed",
        occurred_at: new Date("2026-04-03T08:30:00Z"),
      },
      {
        external_id: "observed:status:2026-04-03T08:30:00.000Z",
        field: "status",
        old_value: "2",
        new_value: "4",
        actor: null,
        origin: "observed",
        occurred_at: new Date("2026-04-03T08:30:00Z"),
      },
    ]);
  });

  it("records nothing when a value reads differently and the source says nothing changed", async () => {
    const connId = await seededFreshdeskConnId();
    const at = "2026-04-01T10:00:00Z";
    const item = await ingestWorkItem(connId, rawItem({ sourceUpdatedAt: at }));
    await ingestWorkItem(
      connId,
      rawItem({ priority: "3", sourceUpdatedAt: at }),
    );
    expect(await events(item.id)).toEqual([]);
  });

  it("replaces what it observed with the source's own history once that is read", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ status: "New", sourceUpdatedAt: "2026-04-01T10:00:00Z" }),
    );
    await ingestWorkItem(
      connId,
      rawItem({
        status: "Active",
        listed: true,
        sourceUpdatedAt: "2026-04-02T10:00:00Z",
      }),
    );
    expect((await events(item.id)).map((e) => e.origin)).toEqual(["observed"]);

    await ingestWorkItem(
      connId,
      rawItem({
        status: "Closed",
        sourceUpdatedAt: "2026-04-03T10:00:00Z",
        historyComplete: true,
        events: [
          {
            externalId: "2:System.State",
            occurredAt: "2026-04-01T16:00:00Z",
            actor: "Bob Dev",
            field: "status",
            oldValue: "New",
            newValue: "Active",
          },
          {
            externalId: "3:System.State",
            occurredAt: "2026-04-03T10:00:00Z",
            actor: "Bob Dev",
            field: "status",
            oldValue: "Active",
            newValue: "Closed",
          },
        ],
      }),
    );
    expect(await events(item.id)).toMatchObject([
      { origin: "source", actor: "Bob Dev", new_value: "Active" },
      { origin: "source", actor: "Bob Dev", new_value: "Closed" },
    ]);
  });
});

describe("the source's record of a customer", () => {
  beforeEach(resetData);

  const records = () => sql`
    select external_id, name, record from source_customer_records order by external_id
  `;
  const acme = (over: Record<string, unknown> = {}) => ({
    name: "Acme",
    record: { id: 9, name: "Acme", tier: "gold", ...over },
  });

  it("keeps one record for a company however many of its tickets are fetched", async () => {
    const connId = await seededFreshdeskConnId();
    const first = await ingestWorkItem(
      connId,
      rawItem({ externalId: "1", customerKey: "9", customerRecord: acme() }),
    );
    await ingestWorkItem(
      connId,
      rawItem({
        externalId: "2",
        customerKey: "9",
        customerRecord: acme({ tier: "platinum" }),
      }),
    );
    expect(await records()).toEqual([
      {
        external_id: "9",
        name: "Acme",
        record: { id: 9, name: "Acme", tier: "platinum" },
      },
    ]);
    const joined = await sql`
      select count(*)::int as n from work_items wi
      join source_customer_records r
        on r.source_connection_id = wi.source_connection_id
       and r.external_id = wi.external_customer_key
    `;
    expect(joined[0].n).toBe(2);
    expect(first.id).toBeTruthy();
  });

  it("points a listed ticket at its company before any record is stored", async () => {
    const connId = await seededFreshdeskConnId();
    const item = await ingestWorkItem(
      connId,
      rawItem({ customerKey: "9", listed: true }),
    );
    const [row] = await sql`
      select external_customer_key from work_items where id = ${item.id}
    `;
    expect(row.external_customer_key).toBe("9");
    expect(await records()).toEqual([]);
  });
});
