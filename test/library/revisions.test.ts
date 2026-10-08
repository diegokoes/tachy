import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  saveKnowledgeEntry,
  updateKnowledgeEntry,
  revertKnowledgeEntry,
  getKnowledgeEntry,
} from "@tachy/core/knowledge";
import { listRevisions, getRevision, changedFields } from "@tachy/core/library";
import { saveReferenceDoc, updateReferenceDoc } from "@tachy/core/reference";
import { createUser } from "@tachy/core/access";
import { resetData, sql, tpdProductId } from "../database";

afterAll(() => sql.end());

const entry = async (over: Record<string, unknown> = {}) =>
  saveKnowledgeEntry({
    productId: await tpdProductId(),
    issueSummary: "printer stalls at 023",
    rootCause: "buffer overrun",
    resolution: "restart the spooler",
    tags: ["printing"],
    ...over,
  });

describe("library revisions", () => {
  beforeEach(resetData);

  it("seeds revision 1 when an entry is created", async () => {
    const saved = await entry();
    const revs = await listRevisions({ entryId: saved.id });
    expect(revs).toHaveLength(1);
    expect(revs[0].version).toBe(1);
    expect(revs[0].changed_fields).toEqual([]);
    const { snapshot } = await getRevision({ entryId: saved.id }, 1);
    expect(snapshot.issue_summary).toBe("printer stalls at 023");
  });

  it("records one revision per update, naming what changed", async () => {
    const saved = await entry();
    await updateKnowledgeEntry(
      saved.id,
      { resolution: "restart the print service" },
      { actor: "web", userId: null },
    );
    const revs = await listRevisions({ entryId: saved.id });
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
    expect(revs[0].changed_fields).toEqual(["resolution"]);
    expect(revs[0].actor).toBe("web");
  });

  it("keeps the snapshot free of the embedding - the reason this is cheap", async () => {
    const saved = await entry();
    const { snapshot } = await getRevision({ entryId: saved.id }, 1);
    expect(snapshot).not.toHaveProperty("embedding");
    expect(Object.keys(snapshot).some((k) => k.startsWith("search_"))).toBe(
      false,
    );
  });

  it("writes NO revision when the optimistic lock rejects the update", async () => {
    const saved = await entry();
    await expect(
      updateKnowledgeEntry(saved.id, {
        resolution: "nope",
        expectedVersion: 99,
      }),
    ).rejects.toThrow(/Version conflict/);
    const revs = await listRevisions({ entryId: saved.id });
    expect(revs).toHaveLength(1);
  });

  it("attributes an agent edit to the human whose turn made it, and to the turn", async () => {
    const user = await createUser({ email: "dev@example.com", role: "member" });
    const saved = await entry();
    await updateKnowledgeEntry(
      saved.id,
      { rootCause: "spooler deadlock" },
      { actor: "agent", userId: user.id, turnId: "turn-abc" },
    );
    const [latest] = await listRevisions({ entryId: saved.id });
    expect(latest.actor).toBe("agent");
    expect(latest.user_id).toBe(user.id);
    expect(latest.turn_id).toBe("turn-abc");
    expect(latest.user_email).toBe("dev@example.com");
  });

  it("distinguishes the same person editing through two different doors", async () => {
    const user = await createUser({ email: "sam@example.com", role: "member" });
    const saved = await entry();
    await updateKnowledgeEntry(
      saved.id,
      { resolution: "a" },
      { actor: "web", userId: user.id },
    );
    await updateKnowledgeEntry(
      saved.id,
      { resolution: "b" },
      { actor: "agent", userId: user.id, turnId: "t1" },
    );
    const revs = await listRevisions({ entryId: saved.id });
    expect(revs.map((r) => r.actor)).toEqual(["agent", "web", "api"]);
    expect(new Set(revs.slice(0, 2).map((r) => r.user_id))).toEqual(
      new Set([user.id]),
    );
  });

  it("reverts by making a new edit, never by rewriting history", async () => {
    const saved = await entry();
    await updateKnowledgeEntry(saved.id, { resolution: "wrong turn" });
    await updateKnowledgeEntry(saved.id, { resolution: "worse turn" });

    const reverted = await revertKnowledgeEntry(saved.id, 1, {
      actor: "web",
      userId: null,
    });
    expect(reverted.version).toBe(4);

    const live = await getKnowledgeEntry(saved.id);
    expect(live.resolution).toBe("restart the spooler");

    const revs = await listRevisions({ entryId: saved.id });
    expect(revs.map((r) => r.version)).toEqual([4, 3, 2, 1]);
    // The bad versions are still there - reverting hides nothing.
    expect(
      (await getRevision({ entryId: saved.id }, 3)).snapshot.resolution,
    ).toBe("worse turn");
  });

  it("goes away with the entry", async () => {
    const saved = await entry();
    await sql`delete from knowledge_entries where id = ${saved.id}`;
    expect(await listRevisions({ entryId: saved.id })).toHaveLength(0);
  });

  it("versions reference docs the same way", async () => {
    const doc = await saveReferenceDoc({
      productId: await tpdProductId(),
      title: "Spooler runbook",
      body: "step one",
    });
    await updateReferenceDoc(
      doc.id,
      { body: "step one\n\nstep two" },
      { actor: "mcp", userId: null },
    );
    const revs = await listRevisions({ docId: doc.id });
    expect(revs.map((r) => r.version)).toEqual([2, 1]);
    expect(revs[0].actor).toBe("mcp");
    expect(revs[0].changed_fields).toEqual(["body"]);
  });
});

describe("changedFields", () => {
  it("compares arrays by content, not by identity", () => {
    expect(changedFields({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toEqual(
      [],
    );
    expect(changedFields({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual([
      "tags",
    ]);
  });

  it("treats null and a missing key as the same absence", () => {
    expect(changedFields({ cloud: null }, {})).toEqual([]);
  });

  it("reports every key that moved, sorted", () => {
    expect(
      changedFields(
        { status: "draft", resolution: "x" },
        { status: "approved", resolution: "y" },
      ),
    ).toEqual(["resolution", "status"]);
  });
});
