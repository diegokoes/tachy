import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addTeam } from "@tachy/core/catalog";
import { getJobKind, registerCoreJobs } from "@tachy/core/jobs";
import {
  addEntryTicket,
  addFeedback,
  saveKnowledgeEntry,
  updateKnowledgeEntry,
} from "@tachy/core/knowledge";
import type { KnowledgeInput } from "@tachy/core/knowledge";
import { recordView } from "@tachy/core/library";
import {
  dismissSignal,
  entryReview,
  getSignal,
  listSignals,
  muteSignal,
  reviewCount,
  sweepSignals,
} from "@tachy/core/review";
import { ticketQueryVectors } from "../../packages/core/src/work-items/query-vectors";
import { RECURRENCE_FLAG_COUNT } from "../../packages/core/src/review/signals";
import {
  resetData,
  seededFreshdeskConnId,
  sql,
  tpdProductId,
} from "../database";

afterAll(() => sql.end());
registerCoreJobs();

let productId = "";
let testTeamId = "";

const lesson = {
  title: "Label queue stalls after a spooler restart",
  issueSummary:
    "Labels stop printing after the spooler restarts until the queue is cleared by hand.",
  rootCause: "the spooler keeps a stale lock file",
  resolution: "delete the lock file and restart the spooler",
};
const lessonText = Object.values(lesson).join(" ");

async function entry(over: Partial<KnowledgeInput> = {}) {
  const saved = await saveKnowledgeEntry({
    ...lesson,
    productId,
    confidence: "high",
    resolutionClarity: "clear",
    ...over,
  });
  return saved.id as string;
}

let ticketNumber = 0;

/** A ticket of the product, opened through the agent on `text`. */
async function openedTicket(text: string) {
  const externalId = String(++ticketNumber);
  const [row] = await sql`
    insert into work_items (source_connection_id, external_id, title, product_id)
    values (${await seededFreshdeskConnId()}, ${externalId},
            ${"ticket " + externalId}, ${productId})
    returning id
  `;
  await ticketQueryVectors(row.id as string, [text]);
  return row.id as string;
}

/** Moves an entry's last edit into the past, which a plain update cannot. */
async function lastEditedDaysAgo(entryId: string, days: number) {
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`
      update knowledge_entries
      set updated_at = now() - make_interval(days => ${days}),
          created_at = least(created_at, now() - make_interval(days => ${days}))
      where id = ${entryId}
    `;
  });
}

async function flagged() {
  await sweepSignals({ productId });
  return listSignals(null);
}

beforeEach(async () => {
  await resetData();
  ticketNumber = 0;
  productId = await tpdProductId();
  const [team] = await sql`select id from teams where slug = 'test-team'`;
  testTeamId = team.id as string;
});

describe("tickets that match an entry", () => {
  it("counts a matching ticket on the entry without flagging it", async () => {
    const entryId = await entry();
    await openedTicket(lessonText);

    expect(await flagged()).toEqual([]);
    const { signals } = await entryReview(entryId, null);
    expect(signals).toMatchObject([
      {
        kind: "recurring",
        score: 1,
        flagged: false,
        evidence: {
          since_edit: 1,
          tickets: [{ external_id: "1", source: "test-freshdesk" }],
        },
      },
    ]);
  });

  it("flags it when the entry says the problem is fixed", async () => {
    await entry({ fixedVersion: "9.2" });
    await openedTicket(lessonText);

    expect(await flagged()).toMatchObject([
      { kind: "recurring", score: 1, evidence: { reason: "fixed" } },
    ]);
  });

  it("flags it when the entry is doubtful", async () => {
    await entry({ confidence: "low" });
    await openedTicket(lessonText);

    expect((await flagged())[0].evidence.reason).toBe("doubtful");
  });

  it("flags by number once enough tickets arrived since the last edit", async () => {
    await entry();
    for (let n = 0; n < RECURRENCE_FLAG_COUNT; n++)
      await openedTicket(lessonText);

    expect(await flagged()).toMatchObject([
      {
        kind: "recurring",
        score: RECURRENCE_FLAG_COUNT,
        evidence: { reason: "volume", since_edit: RECURRENCE_FLAG_COUNT },
      },
    ]);
  });

  it("leaves out the tickets the entry already draws on, and unrelated ones", async () => {
    const source = await openedTicket(lessonText);
    const entryId = await entry({ workItemId: source, fixedVersion: "9.2" });
    const drawnOn = await openedTicket(lessonText);
    await addEntryTicket(entryId, drawnOn, null);
    await openedTicket("the invoice export produces an empty pdf every month");

    expect(await flagged()).toEqual([]);
  });

  it("resolves once the ticket is added to the entry", async () => {
    const entryId = await entry({ fixedVersion: "9.2" });
    const later = await openedTicket(lessonText);
    expect(await flagged()).toHaveLength(1);

    await addEntryTicket(entryId, later, null);

    expect(await flagged()).toEqual([]);
    expect((await entryReview(entryId, null)).signals).toEqual([]);
  });
});

describe("feedback on an entry", () => {
  it("flags a correction until the entry is edited", async () => {
    const entryId = await entry();
    await addFeedback({
      knowledgeEntryId: entryId,
      kind: "correction",
      comment: "the lock file is spool.lock, not queue.lock",
    });

    expect(await flagged()).toMatchObject([
      {
        kind: "corrected",
        knowledge_entry_id: entryId,
        entry_title: lesson.title,
        evidence: {
          notes: [{ kind: "correction", comment: /spool\.lock/ }],
        },
      },
    ]);

    await updateKnowledgeEntry(entryId, { resolution: "delete spool.lock" });
    expect(await flagged()).toEqual([]);
  });

  it("flags low ratings from two readers, not one, and not middling ones", async () => {
    const low = await entry();
    const once = await entry({ title: "Rated once" });
    const middling = await entry({ title: "Rated middling" });
    const rate = (knowledgeEntryId: string, rating: number) =>
      addFeedback({ knowledgeEntryId, kind: "rating", rating });
    await rate(low, 1);
    await rate(low, 2);
    await rate(once, 1);
    await rate(middling, 3);
    await rate(middling, 4);

    const signals = (await flagged()).filter((s) => s.kind === "rated_low");
    expect(signals).toMatchObject([
      {
        knowledge_entry_id: low,
        score: 2,
        evidence: { rating: 1.5, ratings: 2 },
      },
    ]);
  });
});

describe("what else the sweep raises", () => {
  it("raises a near copy on the newer of the two entries", async () => {
    const older = await entry();
    const newer = await entry();

    const signals = (await flagged()).filter((s) => s.kind === "duplicate");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      knowledge_entry_id: newer,
      evidence: { twin: { id: older, title: lesson.title } },
    });
  });

  it("flags a source ticket that got messages after the entry, people's only", async () => {
    const source = await openedTicket("unrelated words about invoices");
    const entryId = await entry({ workItemId: source });
    await sql`
      insert into work_item_messages (work_item_id, external_id, body_text, automated, created_at)
      values (${source}, 'm1', 'it came back after the update', false, now() + interval '1 minute'),
             (${source}, 'm2', 'your ticket is still open', true, now() + interval '2 minutes')
    `;

    expect(await flagged()).toMatchObject([
      {
        kind: "source_changed",
        knowledge_entry_id: entryId,
        score: 1,
        evidence: { messages: 1, ticket: { external_id: "1" } },
      },
    ]);
  });

  it("flags an old entry that is still read, and leaves an unread one alone", async () => {
    const read = await entry();
    const unread = await entry({
      title: "Invoice export is empty",
      issueSummary: "The monthly invoice export produces an empty PDF.",
      rootCause: "the export cache holds a stale template",
      resolution: "clear the export cache",
    });
    await lastEditedDaysAgo(read, 400);
    await lastEditedDaysAgo(unread, 400);
    await recordView({ entryId: read }, null);

    const signals = (await flagged()).filter((s) => s.kind === "aged");
    expect(signals).toMatchObject([
      { knowledge_entry_id: read, score: 1, evidence: { reads: 1 } },
    ]);
  });
});

describe("working the flagged list", () => {
  async function corrections(entryId: string, n: number) {
    for (let i = 0; i < n; i++)
      await addFeedback({
        knowledgeEntryId: entryId,
        kind: "correction",
        comment: `correction ${i}`,
      });
  }

  it("hides a dismissed signal until its evidence grows well past that point", async () => {
    const entryId = await entry();
    await corrections(entryId, 1);
    const [signal] = await flagged();

    await dismissSignal(signal.id, null);
    expect(await flagged()).toEqual([]);

    await corrections(entryId, 1);
    expect(await flagged()).toEqual([]);

    await corrections(entryId, 2);
    expect(await flagged()).toMatchObject([
      { id: signal.id, score: 4, dismissed_score: 1 },
    ]);
  });

  it("never lists a muted signal again and keeps it off the entry's page", async () => {
    const entryId = await entry({ fixedVersion: "9.2" });
    await openedTicket(lessonText);
    const [signal] = await flagged();

    await muteSignal(signal.id, null);
    for (let n = 0; n < 5; n++) await openedTicket(lessonText);

    expect(await flagged()).toEqual([]);
    expect((await entryReview(entryId, null)).signals).toEqual([]);
  });

  it("keeps first_seen_at across sweeps and reopens a resolved signal as new", async () => {
    const entryId = await entry();
    await corrections(entryId, 1);
    const [first] = await flagged();
    const [again] = await flagged();
    expect(again.first_seen_at).toEqual(first.first_seen_at);

    await dismissSignal(first.id, null);
    await updateKnowledgeEntry(entryId, { resolution: "fixed the text" });
    await sweepSignals({ productId });
    await expect(getSignal(first.id)).rejects.toThrow(/no open signal/);

    await corrections(entryId, 1);
    expect(await flagged()).toMatchObject([
      { id: first.id, dismissed_at: null },
    ]);
  });

  it("lists a signal for the team that curates the entry, and counts it", async () => {
    const other = await addTeam("other-team", "Other Team");
    const entryId = await entry();
    await corrections(entryId, 1);
    await sweepSignals({ productId });

    expect(await listSignals([testTeamId])).toHaveLength(1);
    expect(await listSignals([other.id as string])).toEqual([]);
    expect(await reviewCount(null, [testTeamId])).toEqual({
      waiting: 0,
      returned: 0,
      flagged: 1,
    });
    expect((await reviewCount(null, [other.id as string])).flagged).toBe(0);
  });

  it("sweeps every product and says what it found", async () => {
    const entryId = await entry({ fixedVersion: "9.2" });
    await corrections(entryId, 1);
    await openedTicket(lessonText);
    await entry({ title: "No product", productId: null });

    const sweep = await sweepSignals();

    expect(sweep).toMatchObject({ failed: 0, skipped: 0, flagged: 2 });
    expect(sweep.scopes).toBeGreaterThanOrEqual(2);
  });

  it("runs as a job and reports its outcome in a line", async () => {
    const entryId = await entry();
    await corrections(entryId, 1);
    const kind = getJobKind("review.signals");

    const output = (await kind.run({} as never, {})) as Record<string, unknown>;

    expect(output.flagged).toBe(1);
    expect(kind.outcome!(output)).toBe("1 entry flagged of 1 signal");
    expect(kind.outcome!({ flagged: 3, signals: 8, failed: 1 })).toBe(
      "3 entries flagged of 8 signals, 1 failed",
    );
  });
});
