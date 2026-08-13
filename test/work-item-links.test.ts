import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addWorkItemLink,
  deleteWorkItemLink,
  ingestWorkItem,
  listWorkItemLinks,
  recordAdoRefs,
} from "@tachy/core";
import { resetData, seededFreshdeskConnId, sql } from "./helpers";

afterAll(() => sql.end());

const ticket = (externalId: string, over: Record<string, any> = {}) => ({
  externalId,
  kind: "ticket" as const,
  title: `Ticket ${externalId}`,
  groupKey: "48000641379",
  raw: {},
  messages: [],
  ...over,
});

describe("work item links", () => {
  beforeEach(resetData);

  it("records referenced ids once, however often the ticket is re-fetched", async () => {
    const conn = await seededFreshdeskConnId();
    const item = await ingestWorkItem(conn, ticket("100"));

    expect(await recordAdoRefs(item.id, ["50912", "50913"])).toBe(2);
    await recordAdoRefs(item.id, ["50912", "50913"]);

    const links = await listWorkItemLinks(item.id);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.external_id).sort()).toEqual(["50912", "50913"]);
    expect(links.every((l) => l.kind === "tracked_by")).toBe(true);
  });

  it("tightens an external link to a work item once that item is ingested", async () => {
    const conn = await seededFreshdeskConnId();
    const item = await ingestWorkItem(conn, ticket("101"));
    await recordAdoRefs(item.id, ["50912"], { sourceConnectionId: conn });
    expect((await listWorkItemLinks(item.id))[0].work_item_id).toBeNull();

    const adoItem = await ingestWorkItem(conn, {
      ...ticket("50912"),
      kind: "work_item",
      title: "Printer driver crash",
    });
    await recordAdoRefs(item.id, ["50912"], { sourceConnectionId: conn });

    const links = await listWorkItemLinks(item.id);
    expect(links).toHaveLength(1);
    expect(links[0].work_item_id).toBe(adoItem.id);
    expect(links[0].title).toBe("Printer driver crash");
  });

  it("is visible from both ends and follows the source item's deletion", async () => {
    const conn = await seededFreshdeskConnId();
    const from = await ingestWorkItem(conn, ticket("102"));
    const to = await ingestWorkItem(conn, ticket("103"));
    await addWorkItemLink({
      fromWorkItemId: from.id,
      toWorkItemId: to.id,
      kind: "duplicates",
    });

    expect((await listWorkItemLinks(from.id))[0].direction).toBe("out");
    expect((await listWorkItemLinks(to.id))[0].direction).toBe("in");

    await sql`delete from work_items where id = ${from.id}`;
    expect(await listWorkItemLinks(to.id)).toHaveLength(0);
  });

  it("rejects a link with no target and an unknown kind", async () => {
    const conn = await seededFreshdeskConnId();
    const item = await ingestWorkItem(conn, ticket("104"));
    await expect(
      addWorkItemLink({ fromWorkItemId: item.id, kind: "tracked_by" }),
    ).rejects.toThrow(/to_work_item_id or to_external_id/);
    await expect(
      addWorkItemLink({
        fromWorkItemId: item.id,
        toExternalId: "7",
        kind: "sibling" as any,
      }),
    ).rejects.toThrow(/work_item_links_kind_check/);
  });

  it("deletes one link without touching the rest", async () => {
    const conn = await seededFreshdeskConnId();
    const item = await ingestWorkItem(conn, ticket("105"));
    await recordAdoRefs(item.id, ["1", "2"]);
    const [first] = await listWorkItemLinks(item.id);

    await deleteWorkItemLink(first.id);
    expect(await listWorkItemLinks(item.id)).toHaveLength(1);
    await expect(deleteWorkItemLink(first.id)).rejects.toThrow(/not found/);
  });
});
