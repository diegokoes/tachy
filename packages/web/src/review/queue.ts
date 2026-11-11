import type { ProposalRow, ProposalStatus, ReviewQueue } from "@tachy/contract";
import { SIGNAL_LABELS, signalPath } from "./signals";

export type ReviewGroupKey =
  "waiting" | "flagged" | "returned" | "drafts" | "mine";

export interface ReviewRow {
  key: string;
  title: string;
  /** Where the row opens: its proposal, its signal, or the entry of a loose draft. */
  path: string;
  /** What waits: a new entry, an edit, a draft, or why an entry is flagged. */
  badge: string;
  by: string | null;
  at: string;
  status?: ProposalStatus;
}

export interface ReviewGroup {
  key: ReviewGroupKey;
  title: string;
  detail: string;
  rows: ReviewRow[];
}

const HEADS: Record<ReviewGroupKey, { title: string; detail: string }> = {
  waiting: { title: "waiting", detail: "proposed, and not decided yet" },
  flagged: {
    title: "flagged",
    detail: "entries the daily sweep found a reason to read again",
  },
  returned: {
    title: "sent back",
    detail: "returned to the person who proposed it, and waiting on them",
  },
  drafts: { title: "drafts", detail: "draft entries nobody proposed" },
  mine: { title: "mine", detail: "what you proposed, and what came of it" },
};

export const PROPOSAL_TONES: Record<
  ProposalStatus,
  "accent" | "warn" | "ok" | "danger" | "muted"
> = {
  open: "accent",
  returned: "warn",
  accepted: "ok",
  rejected: "danger",
  withdrawn: "muted",
};

export const proposalPath = (id: string) => `/review/${id}`;

const proposalRow = (proposal: ProposalRow): ReviewRow => ({
  key: proposal.id,
  title: proposal.entry_title,
  path: proposalPath(proposal.id),
  badge: proposal.kind,
  by: proposal.submitter_name,
  at: proposal.updated_at,
  status: proposal.status,
});

/**
 * The review list, in the order it is worked: what a reviewer decides, what
 * the sweep flagged, what waits on submitters, loose drafts, then the reader's
 * own proposals that the groups before did not already show. Empty groups are
 * left out.
 */
export function reviewGroups(
  queue: ReviewQueue,
  mine: ProposalRow[],
): ReviewGroup[] {
  const queued = new Set(queue.proposals.map((proposal) => proposal.id));
  const rows: Record<ReviewGroupKey, ReviewRow[]> = {
    waiting: queue.proposals
      .filter((proposal) => proposal.status === "open")
      .map(proposalRow),
    flagged: queue.signals.map((signal) => ({
      key: signal.id,
      title: signal.entry_title,
      path: signalPath(signal.id),
      badge: SIGNAL_LABELS[signal.kind],
      by: null,
      at: signal.first_seen_at,
    })),
    returned: queue.proposals
      .filter((proposal) => proposal.status === "returned")
      .map(proposalRow),
    drafts: queue.drafts.map((draft) => ({
      key: draft.id,
      title: draft.title,
      path: `/library/entries/${draft.id}`,
      badge: "draft",
      by: draft.author_name,
      at: draft.updated_at,
    })),
    mine: mine.filter((proposal) => !queued.has(proposal.id)).map(proposalRow),
  };
  return (Object.keys(HEADS) as ReviewGroupKey[])
    .filter((key) => rows[key].length)
    .map((key) => ({ key, ...HEADS[key], rows: rows[key] }));
}

/** What a bare /review opens on: the first row that opens inside the tab. */
export const firstReviewPath = (groups: ReviewGroup[]): string | null =>
  groups
    .flatMap((group) => group.rows)
    .find((row) => row.path.startsWith("/review/"))?.path ?? null;
