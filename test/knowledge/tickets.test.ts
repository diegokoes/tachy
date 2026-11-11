import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addEntryTicket,
  listEntryTickets,
  removeEntryTicket,
  saveKnowledgeEntry,
  updateKnowledgeEntry,
} from "@tachy/core/knowledge";
import {
  resetData,
  seededFreshdeskConnId,
  sql,
  tqxProductId,
} from "../database";

afterAll(() => sql.end());

async function ticket(externalId: string) {
  const [row] = await sql`
    insert into work_items (source_connection_id, external_id, title, status)
    values (${await seededFreshdeskConnId()}, ${externalId},
            ${"ticket " + externalId}, 'closed')
    returning id
  `;
  return row.id as string;
}

async function entryFrom(workItemId: string | null) {
  const saved = await saveKnowledgeEntry({
    productId: await tqxProductId(),
    workItemId,
    title: "Label queue stalls after a spooler restart",
    resolution: "delete the lock file",
  });
  return saved.id as string;
}

describe("an entry's tickets", () => {
  beforeEach(resetData);

  it("lists the ticket it was written from first, then the added ones in order", async () => {
    const source = await ticket("100");
    const second = await ticket("200");
    const third = await ticket("300");
    const entryId = await entryFrom(source);

    await addEntryTicket(entryId, third, null);
    await addEntryTicket(entryId, second, null);

    expect(
      (await listEntryTickets(entryId)).map((t) => [
        t.external_id,
        t.is_source,
      ]),
    ).toEqual([
      ["100", true],
      ["300", false],
      ["200", false],
    ]);
  });

  it("adds a ticket once, and never the source a second time", async () => {
    const source = await ticket("100");
    const later = await ticket("200");
    const entryId = await entryFrom(source);

    await addEntryTicket(entryId, later, null);
    await addEntryTicket(entryId, later, null);
    await addEntryTicket(entryId, source, null);

    expect(await listEntryTickets(entryId)).toHaveLength(2);
  });

  it("joins the ticket an update draws on, in the update's own write", async () => {
    const later = await ticket("200");
    const entryId = await entryFrom(null);

    await updateKnowledgeEntry(entryId, {
      resolution: "delete spool.lock, then restart",
      workItemId: later,
    });

    expect(await listEntryTickets(entryId)).toMatchObject([
      { external_id: "200", is_source: false, title: "ticket 200" },
    ]);
  });

  it("refuses an update drawing on a ticket that does not exist, and writes nothing", async () => {
    const entryId = await entryFrom(null);

    await expect(
      updateKnowledgeEntry(entryId, {
        resolution: "x",
        workItemId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/work item .* not found/);
    const [{ version }] =
      await sql`select version from knowledge_entries where id = ${entryId}`;
    expect(version).toBe(1);
  });

  it("removes an added ticket and keeps the source", async () => {
    const source = await ticket("100");
    const later = await ticket("200");
    const entryId = await entryFrom(source);
    await addEntryTicket(entryId, later, null);

    await removeEntryTicket(entryId, later);
    await expect(removeEntryTicket(entryId, source)).rejects.toThrow(
      /not one this entry had added/,
    );

    expect((await listEntryTickets(entryId)).map((t) => t.external_id)).toEqual(
      ["100"],
    );
  });
});
