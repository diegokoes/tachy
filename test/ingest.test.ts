import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ingestWorkItem } from "@tachy/core";
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
});
