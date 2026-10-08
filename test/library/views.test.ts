import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  getKnowledgeEntry,
  searchKnowledge,
  listKnowledgeEntries,
} from "@tachy/core/knowledge";
import { saveReferenceDoc } from "@tachy/core/reference";
import { recordView, viewStats, viewHistory } from "@tachy/core/library";
import { createUser } from "@tachy/core/access";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const entry = async () =>
  saveKnowledgeEntry({
    productId: await tpdProductId(),
    issueSummary: "printer stalls at 023",
    resolution: "restart the spooler",
  });

/** Age the bucket so the next read falls outside the dedupe window. */
const ageBucket = (id: string, minutes: number) =>
  sql`update library_views
      set last_viewed_at = now() - ${`${minutes} minutes`}::interval
      where knowledge_entry_id = ${id}`;

describe("library views", () => {
  beforeEach(resetData);

  it("counts a read", async () => {
    const e = await entry();
    await recordView({ entryId: e.id }, null);
    const stats = await viewStats({ entryId: e.id });
    expect(stats.views).toBe(1);
    expect(stats.last_viewed_at).not.toBeNull();
  });

  it("counts two reads inside the dedupe window once", async () => {
    const e = await entry();
    await recordView({ entryId: e.id }, null);
    await recordView({ entryId: e.id }, null);
    await recordView({ entryId: e.id }, null);
    expect((await viewStats({ entryId: e.id })).views).toBe(1);
  });

  it("counts a read after the window as a new visit", async () => {
    const e = await entry();
    await recordView({ entryId: e.id }, null);
    await ageBucket(e.id, 31);
    await recordView({ entryId: e.id }, null);
    expect((await viewStats({ entryId: e.id })).views).toBe(2);
  });

  it("buckets an unattributed read instead of inserting a row per hit", async () => {
    const e = await entry();
    for (let i = 0; i < 5; i++) {
      await recordView({ entryId: e.id }, null);
      await ageBucket(e.id, 31);
    }
    const [{ count }] =
      await sql`select count(*)::int as count from library_views where knowledge_entry_id = ${e.id}`;
    expect(count).toBe(1);
    expect((await viewStats({ entryId: e.id })).views).toBe(5);
  });

  it("counts distinct readers separately", async () => {
    const a = await createUser({ email: "a@example.com", role: "member" });
    const b = await createUser({ email: "b@example.com", role: "member" });
    const e = await entry();
    await recordView({ entryId: e.id }, a.id);
    await recordView({ entryId: e.id }, b.id);
    await recordView({ entryId: e.id }, a.id);
    const stats = await viewStats({ entryId: e.id });
    expect(stats.views).toBe(2);
    expect(stats.viewers).toBe(2);
  });

  it("reports a read curve by day", async () => {
    const e = await entry();
    await recordView({ entryId: e.id }, null);
    const history = await viewHistory({ entryId: e.id });
    expect(history).toHaveLength(1);
    expect(history[0].views).toBe(1);
  });

  it("counts reference docs too", async () => {
    const d = await saveReferenceDoc({
      productId: await tpdProductId(),
      title: "runbook",
      body: "body",
    });
    await recordView({ docId: d.id }, null);
    expect((await viewStats({ docId: d.id })).views).toBe(1);
    expect((await viewStats({ entryId: d.id })).views).toBe(0);
  });

  it("goes away with the entry", async () => {
    const e = await entry();
    await recordView({ entryId: e.id }, null);
    await sql`delete from knowledge_entries where id = ${e.id}`;
    expect((await viewStats({ entryId: e.id })).views).toBe(0);
  });

  // Reading through core, which is all the MCP subprocess does, must never
  // count as a human visit: only the HTTP route the browser calls records one.
  it("does not count agent reads", async () => {
    const e = await entry();
    await getKnowledgeEntry(e.id);
    await listKnowledgeEntries({});
    await searchKnowledge("printer stalls", {});
    expect((await viewStats({ entryId: e.id })).views).toBe(0);
  });
});
