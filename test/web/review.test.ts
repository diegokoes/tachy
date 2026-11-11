import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalRow, ReviewQueue } from "@tachy/contract";

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
const { firstProposalPath, reviewGroups } =
  await import("../../packages/web/src/review/queue");
const { blankDraft } = await import("../../packages/web/src/knowledge/draft");

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

describe("the review list", () => {
  const queue: ReviewQueue = {
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

  it("groups what waits, what went back, loose drafts and the reader's own", () => {
    const groups = reviewGroups(queue, [
      proposal({ id: "open-1" }),
      proposal({ id: "done-1", status: "accepted" }),
    ]);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.key)])).toEqual([
      ["waiting", ["open-1"]],
      ["returned", ["back-1"]],
      ["drafts", ["d1"]],
      ["mine", ["done-1"]],
    ]);
    expect(groups[2].rows[0]).toMatchObject({
      kind: "draft",
      path: "/library/entries/d1",
      by: "tom",
    });
    expect(firstProposalPath(groups)).toBe("/review/open-1");
  });

  it("leaves empty groups out and opens on nothing when only drafts wait", () => {
    const groups = reviewGroups({ proposals: [], drafts: queue.drafts }, []);
    expect(groups.map((g) => g.key)).toEqual(["drafts"]);
    expect(firstProposalPath(groups)).toBeNull();
  });
});

describe("the review tab's count", () => {
  beforeEach(() => {
    api.get.mockReset();
    reviewCounts.waiting = 0;
    reviewCounts.returned = 0;
  });

  it("asks nothing while nobody is signed in", async () => {
    session.me = null;
    await loadReviewCounts();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("adds what waits on the reader as reviewer and as submitter", async () => {
    session.me = {
      email: "a@example.com",
      name: null,
      role: "member",
      via: "password",
    };
    api.get.mockResolvedValue({ waiting: 3, returned: 1 });
    await loadReviewCounts();
    expect(api.get).toHaveBeenCalledWith("/review/count");
    expect(reviewTotal()).toBe(4);
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
