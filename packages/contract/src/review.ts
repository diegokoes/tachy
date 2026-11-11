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

/** What waits on one entry, as its page shows it. */
export interface EntryProposals {
  /** The caller's own waiting proposal on the entry. */
  mine: ProposalRow | null;
  /** Open proposals on the entry, whoever made them. */
  open: number;
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
}

export interface ReviewCount {
  /** Open proposals the caller may decide. */
  waiting: number;
  /** The caller's own proposals a reviewer sent back. */
  returned: number;
}

/** What a save or an update answers once it may have become a proposal. */
export interface Submission {
  id: string;
  status: string;
  version?: number;
  proposed: boolean;
  proposal_id?: string;
}
