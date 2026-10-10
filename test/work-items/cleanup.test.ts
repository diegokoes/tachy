import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { listAudit } from "@tachy/core/audit";
import { addCustomer } from "@tachy/core/catalog";
import type { RawWorkItem } from "@tachy/core/sources";
import {
  deleteStoredItems,
  filterForAudit,
  ingestWorkItem,
  previewStoredItems,
} from "@tachy/core/work-items";
import { createApp } from "../../packages/api/src/app";
import {
  cleanStoredItems,
  cleanTicketsCommand,
  previewLines,
  storedItemFilterOf,
} from "../../packages/cli/src/tickets";
import { json, loginCookie } from "../http";
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
  status: "closed",
  groupKey: "48000641379",
  raw: { id: Number(externalId) },
  sourceUpdatedAt: "2025-03-01T00:00:00Z",
  messages: [
    {
      externalId: `desc-${externalId}`,
      visibility: "public",
      direction: "incoming",
      bodyText: "it broke",
    },
  ],
  ...over,
});

/**
 * Five stored tickets on the seeded connection: three closed and old, one of
 * them the source of a knowledge entry; one open and old; one closed and new.
 */
async function store() {
  const connId = await seededFreshdeskConnId();
  const acme = await addCustomer({ name: "Acme", slug: "acme" });
  const ids: Record<string, string> = {};
  for (const item of [
    ticket("101", { requester: "Dana@Example.com" }),
    ticket("102"),
    ticket("103"),
    ticket("104", { status: "open" }),
    ticket("105", { sourceUpdatedAt: "2026-09-01T00:00:00Z" }),
  ])
    ids[item.externalId] = (await ingestWorkItem(connId, item)).id;
  await sql`update work_items set customer_id = ${acme.id} where id = ${ids["102"]}`;
  await sql`
    insert into knowledge_entries (status, issue_summary, work_item_id)
    values ('approved', 'learned from 103', ${ids["103"]})
  `;
  return ids;
}

const storedIds = async () =>
  (await sql`select external_id from work_items order by external_id`).map(
    (row) => row.external_id as string,
  );

beforeEach(resetData);

describe("previewing a cleanup of stored tickets", () => {
  it("counts what the filters take together, and what is left for an entry", async () => {
    await store();
    const preview = await previewStoredItems({
      connection: "test-freshdesk",
      statuses: ["CLOSED"],
      changedBefore: "2026-01-01",
    });
    expect(preview).toMatchObject({
      matched: 2,
      messages: 2,
      kept_learned_from: 1,
      by_status: [{ status: "closed", n: 2 }],
    });
    expect(preview.sample.map((item) => item.external_id)).toEqual([
      "101",
      "102",
    ]);
    expect(preview.sample[0]).toMatchObject({
      connection: "test-freshdesk",
      title: "ticket 101",
    });
    // Nothing was deleted by looking.
    expect(await storedIds()).toHaveLength(5);
  });

  it("takes the tickets entries were learned from only when told to", async () => {
    await store();
    const preview = await previewStoredItems({
      statuses: ["closed"],
      changedBefore: "2026-01-01",
      includeLearnedFrom: true,
    });
    expect(preview).toMatchObject({ matched: 3, kept_learned_from: 0 });
  });

  it("narrows by customer, product, team and requester", async () => {
    await store();
    expect((await previewStoredItems({ customer: "acme" })).matched).toBe(1);
    expect(
      (await previewStoredItems({ requester: "dana@example.com" })).matched,
    ).toBe(1);
    expect((await previewStoredItems({ product: "tpd" })).matched).toBe(4);
    expect((await previewStoredItems({ team: "test-team" })).matched).toBe(4);
  });

  it("refuses a filter that names nothing, or names what does not exist", async () => {
    await store();
    await expect(previewStoredItems({})).rejects.toThrow(/at least one of/);
    await expect(
      previewStoredItems({ includeLearnedFrom: true, statuses: [] }),
    ).rejects.toThrow(/at least one of/);
    await expect(
      previewStoredItems({ connection: "no-such-connection" }),
    ).rejects.toThrow(/unknown source connection/);
    await expect(previewStoredItems({ team: "no-such-team" })).rejects.toThrow(
      /Unknown team/,
    );
    await expect(
      previewStoredItems({ changedBefore: "last tuesday" }),
    ).rejects.toThrow(/not a date/);
  });
});

describe("deleting stored tickets by filter", () => {
  it("deletes what was previewed, with its messages, and leaves the rest", async () => {
    const ids = await store();
    const filter = { statuses: ["closed"], changedBefore: "2026-01-01" };
    const { matched } = await previewStoredItems(filter);

    expect(await deleteStoredItems(filter, matched)).toEqual({
      deleted: 2,
      messages: 2,
      kept_learned_from: 1,
    });
    expect(await storedIds()).toEqual(["103", "104", "105"]);
    expect(
      await sql`select 1 from work_item_messages where work_item_id in ${sql([ids["101"], ids["102"]])}`,
    ).toHaveLength(0);
  });

  it("leaves an entry in place, without its ticket, when its ticket is taken", async () => {
    await store();
    const filter = { statuses: ["closed"], includeLearnedFrom: true };
    const { matched } = await previewStoredItems(filter);
    await deleteStoredItems(filter, matched);
    const [entry] =
      await sql`select work_item_id from knowledge_entries where issue_summary = 'learned from 103'`;
    expect(entry.work_item_id).toBeNull();
  });

  it("deletes nothing when the count is not the one that was previewed", async () => {
    await store();
    const filter = { statuses: ["closed"], changedBefore: "2026-01-01" };
    await expect(deleteStoredItems(filter, 1)).rejects.toThrow(
      /takes 2 tickets, not the 1 that were previewed/,
    );
    expect(await storedIds()).toHaveLength(5);
  });

  it("keeps a requester out of what the audit trail is given", () => {
    expect(
      filterForAudit({ connection: "c", requester: "dana@example.com" }),
    ).toEqual({ connection: "c", requester: "given" });
    expect(filterForAudit({ statuses: ["closed"] })).toEqual({
      statuses: ["closed"],
    });
  });
});

describe("the cleanup over HTTP", () => {
  async function people() {
    await createUser({
      email: "root@example.com",
      password: "admin-password",
      role: "admin",
    });
    await createUser({ email: "sam@example.com", password: "member-password" });
    return {
      admin: await loginCookie(app, "root@example.com", "admin-password"),
      member: await loginCookie(app, "sam@example.com", "member-password"),
    };
  }
  const post = (cookie: string, path: string, body: unknown) =>
    app.request(`/api/work-items/stored/${path}`, {
      ...json(body),
      headers: { "Content-Type": "application/json", cookie },
    });

  it("is an app admin's, previews first, and is recorded without the requester", async () => {
    await store();
    const { admin, member } = await people();
    const filter = { requester: "dana@example.com", statuses: ["closed"] };

    expect((await post(member, "preview", filter)).status).toBe(403);
    expect(
      (await post(member, "delete", { ...filter, expected: 1 })).status,
    ).toBe(403);

    const preview = await post(admin, "preview", filter);
    expect(preview.status).toBe(200);
    const { matched } = await preview.json();
    expect(matched).toBe(1);

    expect(
      (await post(admin, "delete", { ...filter, expected: 5 })).status,
    ).toBe(400);
    const deleted = await post(admin, "delete", {
      ...filter,
      expected: matched,
    });
    expect(await deleted.json()).toEqual({
      deleted: 1,
      messages: 1,
      kept_learned_from: 0,
    });
    expect(await storedIds()).toEqual(["102", "103", "104", "105"]);

    const [event] = await listAudit({ action: "work_items_cleanup" });
    expect(event).toMatchObject({
      actor_email: "root@example.com",
      target: "every connection",
      detail: { requester: "given", statuses: ["closed"], deleted: 1 },
    });
    expect(JSON.stringify(event)).not.toContain("dana@example.com");
  });

  it("refuses a body with no filter", async () => {
    const { admin } = await people();
    expect((await post(admin, "preview", {})).status).toBe(400);
  });
});

describe("the cleanup from the command line", () => {
  it("reads the filter from its flags", () => {
    expect(
      storedItemFilterOf({
        connection: "test-freshdesk",
        status: "closed, resolved",
        before: "2026-01-01",
        "include-learned-from": "true",
      }),
    ).toMatchObject({
      connection: "test-freshdesk",
      statuses: ["closed", "resolved"],
      changedBefore: "2026-01-01",
      includeLearnedFrom: true,
    });
    expect(storedItemFilterOf({}).includeLearnedFrom).toBe(false);
  });

  it("only looks without --yes, and says what it would take", async () => {
    await store();
    const filter = storedItemFilterOf({
      status: "closed",
      before: "2026-01-01",
    });
    const { preview, cleanup } = await cleanStoredItems(filter, false);
    expect(cleanup).toBeUndefined();
    expect(await storedIds()).toHaveLength(5);

    const lines = previewLines(preview);
    expect(lines[0]).toBe("2 stored ticket(s) match, with 2 message(s)");
    expect(lines[1]).toMatch(/^1 more match and are left/);
    expect(lines.join("\n")).toContain("test-freshdesk 101");
  });

  it("deletes with --yes and records it as the command line's", async () => {
    await store();
    const filter = storedItemFilterOf({
      status: "closed",
      before: "2026-01-01",
    });
    const { cleanup } = await cleanStoredItems(filter, true);
    expect(cleanup).toMatchObject({ deleted: 2, messages: 2 });
    expect(await storedIds()).toEqual(["103", "104", "105"]);
    expect((await listAudit())[0]).toMatchObject({
      action: "work_items_cleanup",
      actor_email: null,
      detail: { by: "cli", deleted: 2 },
    });
  });

  it("prints the preview, then what it did", async () => {
    await store();
    const flags = { status: "closed", before: "2026-01-01" };
    const looked = await cleanTicketsCommand(flags);
    expect(looked.at(-1)).toBe(
      "nothing deleted; pass --yes to delete what matches",
    );
    const cleaned = await cleanTicketsCommand({ ...flags, yes: "true" });
    expect(cleaned.at(-1)).toBe("deleted 2 ticket(s) and 2 message(s)");
    // With nothing left to take, there is nothing to say beyond the count.
    expect(await cleanTicketsCommand({ ...flags, yes: "true" })).toEqual([
      "0 stored ticket(s) match, with 0 message(s)",
      expect.stringMatching(/^1 more match and are left/),
    ]);
  });

  it("records nothing when nothing matches", async () => {
    await store();
    const { cleanup } = await cleanStoredItems(
      { statuses: ["archived"] },
      true,
    );
    expect(cleanup).toBeUndefined();
    expect(await listAudit()).toHaveLength(0);
  });
});
