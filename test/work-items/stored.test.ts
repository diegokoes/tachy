import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { addCustomer } from "@tachy/core/catalog";
import type { RawWorkItem } from "@tachy/core/sources";
import {
  ingestWorkItem,
  listStoredItems,
  readStoredItem,
} from "@tachy/core/work-items";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData, seededFreshdeskConnId, sql } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

const ticket = (
  externalId: string,
  over: Partial<RawWorkItem> = {},
): RawWorkItem => ({
  externalId,
  kind: "ticket",
  title: `ticket ${externalId}`,
  status: "2",
  groupKey: "48000641379",
  raw: { id: Number(externalId) },
  sourceCreatedAt: "2026-04-01T10:00:00Z",
  sourceUpdatedAt: "2026-04-01T10:00:00Z",
  messages: [
    {
      externalId: `desc-${externalId}`,
      author: "42",
      authorLabel: "jane@acme.com",
      visibility: "public",
      direction: "incoming",
      bodyText: "the scanner is offline",
      attachments: [{ id: "900", name: "screen.png" }],
      createdAt: "2026-04-01T10:00:00Z",
    },
  ],
  ...over,
});

describe("listStoredItems", () => {
  beforeEach(resetData);

  it("lists the copies newest first, with their counts and whether each was read whole", async () => {
    const connId = await seededFreshdeskConnId();
    await ingestWorkItem(
      connId,
      ticket("1", {
        events: [
          {
            externalId: "created",
            occurredAt: "2026-04-01T10:00:00Z",
            field: "created",
          },
        ],
      }),
    );
    await ingestWorkItem(
      connId,
      ticket("2", {
        listed: true,
        messages: [],
        sourceUpdatedAt: "2026-04-05T10:00:00Z",
        assignee: "7",
        priority: "3",
        itemType: "Incident",
      }),
    );

    const page = await listStoredItems({});
    expect(page.total).toBe(2);
    expect(page.items).toMatchObject([
      {
        external_id: "2",
        connection: "test-freshdesk",
        source_type: "freshdesk",
        assignee: "7",
        priority: "3",
        item_type: "Incident",
        updated_at: "2026-04-05T10:00:00.000Z",
        fetched_at: null,
        messages: 0,
        events: 0,
      },
      { external_id: "1", messages: 1, events: 1 },
    ]);
    expect(page.items[1].fetched_at).toMatch(/^\d{4}-/);
  });

  it("narrows by the cleanup's filter, and by words of the title or the id", async () => {
    const connId = await seededFreshdeskConnId();
    const acme = await addCustomer({
      name: "Acme",
      slug: "acme",
      emailDomains: ["acme.com"],
    });
    await ingestWorkItem(
      connId,
      ticket("1", { title: "Scanner offline", requesterEmail: "a@acme.com" }),
    );
    await ingestWorkItem(
      connId,
      ticket("2", { title: "Label skewed", status: "5" }),
    );
    await ingestWorkItem(connId, ticket("31", { title: "Printer jam" }));

    const titles = async (...args: Parameters<typeof listStoredItems>) =>
      (await listStoredItems(...args)).items.map((i) => i.external_id).sort();

    expect(acme.id).toBeTruthy();
    expect(await titles({ customer: "acme" })).toEqual(["1"]);
    expect(await titles({ statuses: ["5"] })).toEqual(["2"]);
    expect(await titles({}, { query: "scanner" })).toEqual(["1"]);
    expect(await titles({}, { query: "31" })).toEqual(["31"]);
    expect(await titles({ statuses: ["2"] }, { query: "jam" })).toEqual(["31"]);
    await expect(listStoredItems({ connection: "nope" })).rejects.toThrow(
      /unknown source connection/,
    );
  });

  it("pages, and says how many there are in all", async () => {
    const connId = await seededFreshdeskConnId();
    for (const id of ["1", "2", "3"])
      await ingestWorkItem(
        connId,
        ticket(id, { sourceUpdatedAt: `2026-04-0${id}T10:00:00Z` }),
      );
    const second = await listStoredItems({}, { limit: 2, offset: 2 });
    expect(second.total).toBe(3);
    expect(second.items.map((i) => i.external_id)).toEqual(["1"]);
    expect((await listStoredItems({}, { limit: 500 })).items).toHaveLength(3);
  });
});

describe("readStoredItem", () => {
  beforeEach(resetData);

  it("gives the item with messages and events as one timeline, an event ahead of a message of the same moment", async () => {
    const connId = await seededFreshdeskConnId();
    const { id } = await ingestWorkItem(
      connId,
      ticket("1", {
        customerKey: "9",
        customerRecord: { name: "Acme", record: { id: 9, tier: "gold" } },
        events: [
          {
            externalId: "created",
            occurredAt: "2026-04-01T10:00:00Z",
            field: "created",
          },
          {
            externalId: "stats:resolved_at:2026-04-03T09:00:00Z",
            occurredAt: "2026-04-03T09:00:00Z",
            field: "resolved",
          },
        ],
        messages: [
          ...ticket("1").messages,
          {
            externalId: "m2",
            authorLabel: "support (automated)",
            automated: true,
            visibility: "public",
            direction: "outgoing",
            bodyText: "we received your request",
            createdAt: "2026-04-01T10:00:05Z",
          },
        ],
      }),
    );

    const stored = await readStoredItem(id);
    expect(stored.item).toMatchObject({
      external_id: "1",
      messages: 2,
      events: 2,
    });
    expect(
      stored.timeline.map((e) => (e.kind === "event" ? e.field : e.text)),
    ).toEqual([
      "created",
      "the scanner is offline",
      "we received your request",
      "resolved",
    ]);
    expect(stored.timeline[1]).toMatchObject({
      kind: "message",
      at: "2026-04-01T10:00:00.000Z",
      author: "42",
      author_label: "jane@acme.com",
      automated: false,
      direction: "incoming",
      files: 1,
    });
    expect(stored.timeline[3]).toMatchObject({
      kind: "event",
      origin: "source",
      old_value: null,
    });
    expect(stored.customer_record).toMatchObject({
      name: "Acme",
      record: { id: 9, tier: "gold" },
    });
  });

  it("has no customer record for an item whose source keeps none", async () => {
    const connId = await seededFreshdeskConnId();
    const { id } = await ingestWorkItem(connId, ticket("1"));
    expect((await readStoredItem(id)).customer_record).toBeNull();
  });

  it("refuses an id that names nothing", async () => {
    await expect(
      readStoredItem("00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(/not found/);
  });
});

describe("the stored copies over HTTP", () => {
  beforeEach(resetData);

  // With an admin on record the app is no longer open to whoever asks.
  async function member() {
    await createUser({
      email: "root@example.com",
      password: "admin-password",
      role: "admin",
    });
    await createUser({ email: "sam@example.com", password: "member-password" });
    return loginCookie(app, "sam@example.com", "member-password");
  }
  const get = (cookie: string, path: string) =>
    app.request(`/api/work-items/stored${path}`, { headers: { cookie } });

  it("lists and opens them for anyone signed in", async () => {
    const connId = await seededFreshdeskConnId();
    const { id } = await ingestWorkItem(connId, ticket("1"));
    await ingestWorkItem(connId, ticket("2", { status: "5" }));
    const cookie = await member();

    const list = await get(cookie, "?status=5,4&limit=10");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      total: 1,
      items: [{ external_id: "2" }],
    });

    const one = await get(cookie, `/${id}`);
    expect(one.status).toBe(200);
    expect((await one.json()).timeline).toHaveLength(1);
  });

  it("turns away someone not signed in, a malformed id and an unknown one", async () => {
    const cookie = await member();
    expect((await get("", "")).status).toBe(401);
    expect((await get(cookie, "/not-an-id")).status).toBe(400);
    expect(
      (await get(cookie, "/00000000-0000-4000-8000-000000000000")).status,
    ).toBe(404);
    expect((await get(cookie, "?limit=0")).status).toBe(400);
  });
});
