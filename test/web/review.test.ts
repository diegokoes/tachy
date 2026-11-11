import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalRow, ReviewQueue, SignalRow } from "@tachy/contract";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../packages/web/src/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api,
}));

const { session } =
  await import("../../packages/web/src/access/session.svelte");
const { loadReviewCounts, reviewCounts, reviewTotal } =
  await import("../../packages/web/src/review/review.svelte");
const { diffItems, diffTokens, diffWords } =
  await import("../../packages/web/src/review/diff");
const { patchLabels, pendingLine, proposedChanges } =
  await import("../../packages/web/src/review/changes");
const { firstReviewPath, reviewGroups } =
  await import("../../packages/web/src/review/queue");
const { settledByTicket, signalLine, signalTickets, ticketRef } =
  await import("../../packages/web/src/review/signals");
const { blankDraft } = await import("../../packages/web/src/knowledge/draft");
const { adviceLines, checkLine } =
  await import("../../packages/web/src/review/precheck");

const entry = {
  ...blankDraft(),
  title: "Spooler stalls on long batches",
  resolution: "Restart the spooler.",
  tags: ["printing", "spooler"],
  hiddenFix: false,
};

const proposal = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  id: "p1",
  kind: "edit",
  status: "open",
  knowledge_entry_id: "e1",
  entry_title: entry.title,
  entry_status: "approved",
  entry_version: 2,
  product_id: null,
  team_id: null,
  patch: { resolution: "Clear the queue. Restart the spooler." },
  base_version: 2,
  work_item_id: null,
  note: null,
  submitted_by: "u1",
  submitter_name: "ana",
  actor: "web",
  decided_by: null,
  decider_name: null,
  decided_at: null,
  accepted_version: null,
  precheck: null,
  created_at: "2026-11-01T08:00:00Z",
  updated_at: "2026-11-02T08:00:00Z",
  ...over,
});

const marks = (parts: { text: string; change: string }[]) =>
  parts.map((part) => `${part.change}:${part.text}`);

describe("a word diff", () => {
  it("keeps what both sides share and marks the rest", () => {
    expect(
      marks(diffWords("restart the spooler", "restart the print spooler")),
    ).toEqual(["same:restart the ", "added:print ", "same:spooler"]);
  });

  it("rejoins into each side's text", () => {
    const before = "Delete the lock file.\nRestart the spooler.";
    const after = "Delete spool.lock, then restart the spooler.";
    const parts = diffWords(before, after);
    const side = (dropped: string) =>
      parts
        .filter((part) => part.change !== dropped)
        .map((part) => part.text)
        .join("");
    expect(side("added")).toBe(before);
    expect(side("removed")).toBe(after);
  });

  it("shows a rewrite as one removal and one addition", () => {
    expect(
      marks(diffWords("paginate the export", "clear the queue first")),
    ).toEqual(["removed:paginate the export", "added:clear the queue first"]);
  });

  it("marks an empty side as all added or all removed", () => {
    expect(marks(diffWords("", "new text"))).toEqual(["added:new text"]);
    expect(marks(diffWords("old text", ""))).toEqual(["removed:old text"]);
  });

  it("shows both sides whole when comparing them would cost too much", () => {
    const before = Array.from({ length: 2100 }, (_, i) => `a${i}`);
    const after = Array.from({ length: 2100 }, (_, i) => `b${i}`);
    expect(diffTokens(before, after).map((part) => part.change)).toEqual([
      "removed",
      "added",
    ]);
  });
});

describe("a list diff", () => {
  it("lists the new order, then what was dropped", () => {
    expect(marks(diffItems(["a", "b"], ["b", "c"]))).toEqual([
      "same:b",
      "added:c",
      "removed:a",
    ]);
  });
});

describe("what a proposal changes", () => {
  it("compares an open edit with the live entry, field by field", () => {
    const [change] = proposedChanges(entry, proposal());
    expect(change).toMatchObject({
      field: "resolution",
      label: "resolution",
      isList: false,
      conflicting: false,
    });
    expect(marks(change.parts)).toEqual([
      "added:Clear the queue. ",
      "same:Restart the spooler.",
    ]);
  });

  it("flags the fields someone else changed since", () => {
    const changes = proposedChanges(
      entry,
      proposal({
        patch: { resolution: "x", tags: ["printing"], hiddenFix: true },
        conflicting_fields: ["tags"],
      }),
    );
    expect(changes.map((c) => [c.field, c.conflicting])).toEqual([
      ["resolution", false],
      ["tags", true],
      ["hiddenFix", false],
    ]);
    expect(marks(changes[1].parts)).toEqual([
      "same:printing",
      "removed:spooler",
    ]);
    expect(marks(changes[2].parts)).toEqual(["removed:no", "added:yes"]);
    expect(changes.map((c) => c.isRewrite)).toEqual([true, false, true]);
  });

  it("shows a decided edit's values with nothing marked", () => {
    const [change] = proposedChanges(entry, proposal({ status: "accepted" }));
    expect(marks(change.parts)).toEqual([
      "same:Clear the queue. Restart the spooler.",
    ]);
  });

  it("lists what a new entry holds, without its status", () => {
    const changes = proposedChanges(
      { ...entry, status: "draft" },
      proposal({ kind: "new", patch: null, base_version: null }),
    );
    expect(changes.map((c) => c.field)).toEqual([
      "title",
      "resolution",
      "tags",
    ]);
    expect(
      changes.every((c) => c.parts.every((p) => p.change === "same")),
    ).toBe(true);
  });

  it("names a patch's fields as the entry page does", () => {
    expect(patchLabels({ issueSummary: "x", cloud: null })).toEqual([
      "summary",
      "environment",
    ]);
    expect(patchLabels(null)).toEqual([]);
  });

  it("tells a person where their own proposal stands", () => {
    expect(pendingLine(proposal())).toBe(
      "your change to resolution waits for review",
    );
    expect(pendingLine(proposal({ status: "returned" }))).toBe(
      "a reviewer sent your change to resolution back",
    );
    expect(pendingLine(proposal({ kind: "new", patch: null }))).toBe(
      "this draft waits for review",
    );
  });
});

const ticket = {
  work_item_id: "w1",
  source: "support-desk",
  external_id: "4711",
  title: "queue stalled again",
  url: null,
};

const signal = (over: Partial<SignalRow> = {}): SignalRow => ({
  id: "s1",
  kind: "recurring",
  knowledge_entry_id: "e1",
  entry_title: entry.title,
  product_id: null,
  team_id: null,
  score: 4,
  evidence: { tickets: [ticket], since_edit: 3, reason: "fixed" },
  flagged: true,
  first_seen_at: "2026-11-04T08:00:00Z",
  last_seen_at: "2026-11-05T08:00:00Z",
  dismissed_at: null,
  dismissed_score: null,
  ...over,
});

describe("why an entry is flagged", () => {
  it("says what a recurrence rests on", () => {
    expect(signalLine(signal())).toBe(
      "marked fixed, and 4 matching tickets arrived since",
    );
    expect(
      signalLine(signal({ evidence: { reason: "doubtful" }, score: 1 })),
    ).toBe("not sure of its cause or fix, and seen on 1 matching ticket");
    expect(
      signalLine(signal({ evidence: { reason: "volume", since_edit: 3 } })),
    ).toBe("3 matching tickets since its last edit");
    expect(signalLine(signal({ evidence: {}, score: 1, flagged: false }))).toBe(
      "seen on 1 more ticket",
    );
  });

  it("has a line for every other kind", () => {
    expect(signalLine(signal({ kind: "corrected", score: 2 }))).toBe(
      "2 corrections since its last edit",
    );
    expect(
      signalLine(
        signal({ kind: "rated_low", evidence: { rating: 1.5, ratings: 2 } }),
      ),
    ).toBe("rated 1.5 of 5 by 2 readers since its last edit");
    expect(
      signalLine(
        signal({ kind: "source_changed", score: 1, evidence: { ticket } }),
      ),
    ).toBe("1 new message on its source ticket #4711");
    expect(
      signalLine(
        signal({
          kind: "duplicate",
          evidence: { twin: { id: "e2", title: "Older", similarity: 0.9 } },
        }),
      ),
    ).toBe('nearly the same as "Older"');
    expect(signalLine(signal({ kind: "aged", score: 12 }))).toBe(
      "untouched for over a year, read 12 times in the last 90 days",
    );
  });

  it("names its tickets to the agent by connection and id", () => {
    expect(signalTickets(signal()).map(ticketRef)).toEqual([
      "support-desk:4711",
    ]);
    expect(
      signalTickets(signal({ kind: "source_changed", evidence: { ticket } })),
    ).toEqual([ticket]);
    expect(signalTickets(signal({ kind: "aged", evidence: {} }))).toEqual([]);
  });

  it("offers the agent only where a ticket can settle it", () => {
    expect(settledByTicket(signal())).toBe(true);
    expect(settledByTicket(signal({ kind: "source_changed" }))).toBe(true);
    expect(settledByTicket(signal({ kind: "rated_low" }))).toBe(false);
  });
});

describe("a proposal's pre-check", () => {
  it("has a line for every finding", () => {
    expect(checkLine({ code: "no_resolution" })).toBe("no resolution");
    expect(checkLine({ code: "near_copy", copies: [] })).toMatch(
      /nearly the same/,
    );
  });

  it("says the model has not read an open proposal, and nothing once decided", () => {
    expect(adviceLines({ checks: [] }, { waiting: true })).toEqual([
      "the model has not read this yet",
    ]);
    expect(adviceLines(null, { waiting: false })).toEqual([]);
  });

  it("passes the model's suggestions through, or says it has none", () => {
    const read = (suggestions: string[]) =>
      adviceLines(
        {
          checks: [],
          advice: { available: true, ok: !suggestions.length, suggestions },
        },
        { waiting: true },
      );
    expect(read(["name the lock file"])).toEqual(["name the lock file"]);
    expect(read([])).toEqual(["the model has no remarks"]);
  });

  it("stays silent where no credential could read it", () => {
    expect(
      adviceLines(
        { checks: [], advice: { available: false, ok: true, suggestions: [] } },
        { waiting: true },
      ),
    ).toEqual([]);
  });
});

describe("the review list", () => {
  const queue: ReviewQueue = {
    signals: [signal()],
    proposals: [
      proposal({ id: "open-1" }),
      proposal({ id: "back-1", status: "returned" }),
    ],
    drafts: [
      {
        id: "d1",
        title: "Half-written note",
        product_id: null,
        team_id: null,
        created_by: "u2",
        author_name: "tom",
        updated_at: "2026-11-03T08:00:00Z",
      },
    ],
  };

  it("groups what waits, what is flagged, what went back, loose drafts and the reader's own", () => {
    const groups = reviewGroups(queue, [
      proposal({ id: "open-1" }),
      proposal({ id: "done-1", status: "accepted" }),
    ]);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.key)])).toEqual([
      ["waiting", ["open-1"]],
      ["flagged", ["s1"]],
      ["returned", ["back-1"]],
      ["drafts", ["d1"]],
      ["mine", ["done-1"]],
    ]);
    expect(groups[1].rows[0]).toMatchObject({
      badge: "recurring",
      path: "/review/signals/s1",
    });
    expect(groups[3].rows[0]).toMatchObject({
      badge: "draft",
      path: "/library/entries/d1",
      by: "tom",
    });
    expect(firstReviewPath(groups)).toBe("/review/open-1");
  });

  it("leaves empty groups out and opens on nothing when only drafts wait", () => {
    const groups = reviewGroups(
      { proposals: [], drafts: queue.drafts, signals: [] },
      [],
    );
    expect(groups.map((g) => g.key)).toEqual(["drafts"]);
    expect(firstReviewPath(groups)).toBeNull();
  });
});

describe("the review tab's count", () => {
  beforeEach(() => {
    api.get.mockReset();
    reviewCounts.waiting = 0;
    reviewCounts.returned = 0;
    reviewCounts.flagged = 0;
  });

  it("asks nothing while nobody is signed in", async () => {
    session.me = null;
    await loadReviewCounts();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("adds what waits on the reader: to decide, to answer, and flagged", async () => {
    session.me = {
      email: "a@example.com",
      name: null,
      role: "member",
      via: "password",
    };
    api.get.mockResolvedValue({ waiting: 3, returned: 1, flagged: 2 });
    await loadReviewCounts();
    expect(api.get).toHaveBeenCalledWith("/review/count");
    expect(reviewTotal()).toBe(6);
  });

  it("keeps the last count when the request fails", async () => {
    session.me = {
      email: "a@example.com",
      name: null,
      role: "member",
      via: "password",
    };
    reviewCounts.waiting = 2;
    api.get.mockRejectedValue(new Error("down"));
    await loadReviewCounts();
    expect(reviewTotal()).toBe(2);
  });
});
