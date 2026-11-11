import type { KnowledgeStatus, LibraryActor } from "./vocabulary";

/**
 * What a proposal asks for. A 'new' item is stored as a draft the proposal
 * points at; an 'edit' leaves the live item alone and carries the changed
 * fields itself.
 */
export const PROPOSAL_KINDS = ["new", "edit"] as const;
export const PROPOSAL_STATUSES = [
  "open",
  "returned",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
/** Still waiting: 'open' on a reviewer, 'returned' on the submitter. */
export const PENDING_PROPOSAL_STATUSES = ["open", "returned"] as const;
export const PROPOSAL_DIRECTIONS = ["reviewer", "submitter"] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ProposalDirection = (typeof PROPOSAL_DIRECTIONS)[number];

export interface ProposalMessageRow {
  id: string;
  proposal_id: string;
  author_id: string | null;
  author_name: string | null;
  direction: ProposalDirection;
  body_text: string;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  knowledge_entry_id: string;
  entry_title: string;
  entry_status: KnowledgeStatus;
  entry_version: number;
  product_id: string | null;
  team_id: string | null;
  /** The proposed fields, keyed as the entry's update takes them. Null for 'new'. */
  patch: Record<string, unknown> | null;
  /** The entry version the patch was written against. Null for 'new'. */
  base_version: number | null;
  work_item_id: string | null;
  note: string | null;
  submitted_by: string | null;
  submitter_name: string | null;
  actor: LibraryActor;
  decided_by: string | null;
  decider_name: string | null;
  decided_at: string | null;
  /** The entry version the acceptance produced. */
  accepted_version: number | null;
  created_at: string;
  updated_at: string;
  /** Patch fields changed on the entry since `base_version`; on a single read only. */
  conflicting_fields?: string[];
  messages?: ProposalMessageRow[];
  /** Which sides of the proposal the caller is on; set by the API on a single read. */
  viewer?: { submitter: boolean; reviewer: boolean };
}

/**
 * Why the sweep raises an item, most pressing first: the order a reviewer
 * works the list in.
 */
export const LIBRARY_SIGNAL_KINDS = [
  "corrected",
  "recurring",
  "rated_low",
  "source_changed",
  "duplicate",
  "aged",
] as const;
export type LibrarySignalKind = (typeof LIBRARY_SIGNAL_KINDS)[number];

/** A ticket named in a signal's evidence. */
export interface SignalTicket {
  work_item_id: string;
  /** The connection's slug, which with `external_id` names the ticket to the agent. */
  source: string;
  external_id: string;
  title: string | null;
  url: string | null;
}

/**
 * What a signal rests on, by kind. `recurring`: `tickets`, `since_edit`,
 * `last_at` and why it is flagged. `corrected`: `notes`. `rated_low`: `rating`
 * and `ratings`. `duplicate`: `twin`. `source_changed`: `messages` and
 * `ticket`. `aged`: `reads` and `updated_at`.
 */
export interface SignalEvidence {
  tickets?: SignalTicket[];
  since_edit?: number;
  last_at?: string;
  reason?: "fixed" | "doubtful" | "volume";
  notes?: { kind: string; comment: string | null }[];
  rating?: number;
  ratings?: number;
  twin?: { id: string; title: string; similarity: number };
  messages?: number;
  ticket?: SignalTicket;
  reads?: number;
  updated_at?: string;
}

export interface SignalRow {
  id: string;
  kind: LibrarySignalKind;
  knowledge_entry_id: string;
  entry_title: string;
  product_id: string | null;
  team_id: string | null;
  score: number;
  evidence: SignalEvidence;
  /** False: counted on the entry's page only. */
  flagged: boolean;
  first_seen_at: string;
  last_seen_at: string;
  dismissed_at: string | null;
  dismissed_score: number | null;
}

/** What waits on one entry, as its page shows it. */
export interface EntryReview {
  /** The caller's own waiting proposal on the entry. */
  mine: ProposalRow | null;
  /** Open proposals on the entry, whoever made them. */
  open: number;
  /** What the sweep holds on the entry, the unflagged counts included. */
  signals: SignalRow[];
}

/** A draft entry nobody has proposed: a curator's own unfinished work. */
export interface UnproposedDraft {
  id: string;
  title: string;
  product_id: string | null;
  team_id: string | null;
  created_by: string | null;
  author_name: string | null;
  updated_at: string;
}

export interface ReviewQueue {
  proposals: ProposalRow[];
  drafts: UnproposedDraft[];
  signals: SignalRow[];
}

export interface ReviewCount {
  /** Open proposals the caller may decide. */
  waiting: number;
  /** The caller's own proposals a reviewer sent back. */
  returned: number;
  /** Flagged entries in the teams the caller curates. */
  flagged: number;
}

/** What a save or an update answers once it may have become a proposal. */
export interface Submission {
  id: string;
  status: string;
  version?: number;
  proposed: boolean;
  proposal_id?: string;
}
