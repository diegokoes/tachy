import {
  PENDING_PROPOSAL_STATUSES,
  type EntryReview,
  type LibraryActor,
  type ProposalDirection,
  type ProposalKind,
  type ProposalMessageRow,
  type ProposalRow,
  type ReviewCount,
  type UnproposedDraft,
} from "@tachy/contract";
import { sql, jsonb } from "../infra/db";
import type { Db } from "../infra/db";
import { notFound } from "../infra/errors";
import type { KnowledgeUpdateInput } from "../knowledge/knowledge";
import { curatedBy, type ReviewerTeams } from "./scope";
import { entrySignals, listedSignal } from "./signals";

const pendingStatuses = [...PENDING_PROPOSAL_STATUSES];

const QUEUE_LIMIT = 200;
const OWN_PROPOSALS_LIMIT = 100;

type PatchField = Exclude<
  keyof KnowledgeUpdateInput,
  "expectedVersion" | "workItemId"
>;

/** The revision column each patch field writes, for holding a patch against history. */
const PATCH_COLUMNS: Record<PatchField, string> = {
  status: "status",
  title: "title",
  issueSummary: "issue_summary",
  rootCause: "root_cause",
  resolution: "resolution",
  investigation: "investigation",
  resolutionPattern: "resolution_pattern",
  symptoms: "symptoms",
  signals: "signals",
  tags: "tags",
  relatedLinks: "related_links",
  component: "component_id",
  customerSlug: "customer_id",
  unit: "customer_unit_id",
  supersededBy: "superseded_by",
  confidence: "confidence",
  cloud: "cloud",
  resolutionClarity: "resolution_clarity",
  hiddenFix: "hidden_fix",
  affectedVersion: "affected_version",
  fixedVersion: "fixed_version",
};

const PROPOSAL_COLUMNS = sql`
  p.id, p.kind, p.status, p.knowledge_entry_id,
  e.title as entry_title, e.status as entry_status, e.version as entry_version,
  e.product_id, e.team_id,
  p.patch, p.base_version, p.work_item_id, p.note,
  p.submitted_by, coalesce(submitter.display_name, submitter.email) as submitter_name,
  p.actor,
  p.decided_by, coalesce(decider.display_name, decider.email) as decider_name,
  p.decided_at, p.accepted_version, p.precheck, p.created_at, p.updated_at
`;

const PROPOSAL_SOURCE = sql`
  library_proposals p
  join knowledge_entries e on e.id = p.knowledge_entry_id
  left join users submitter on submitter.id = p.submitted_by
  left join users decider on decider.id = p.decided_by
`;

export interface NewProposal {
  entryId: string;
  kind: ProposalKind;
  patch?: Record<string, unknown> | null;
  baseVersion?: number | null;
  workItemId?: string | null;
  note?: string | null;
  submittedBy: string;
  actor: LibraryActor;
  turnId?: string | null;
}

/**
 * Stores a proposal. A person's second edit of an entry replaces their waiting
 * one and reopens it, so a reviewer never holds two patches from one author.
 */
export async function upsertProposal(
  db: Db,
  proposal: NewProposal,
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into library_proposals
      (knowledge_entry_id, kind, patch, base_version, work_item_id, note,
       submitted_by, actor, turn_id)
    values
      (${proposal.entryId}, ${proposal.kind},
       ${proposal.patch ? jsonb(proposal.patch) : null},
       ${proposal.baseVersion ?? null}, ${proposal.workItemId ?? null},
       ${proposal.note ?? null}, ${proposal.submittedBy}, ${proposal.actor},
       ${proposal.turnId ?? null})
    on conflict (knowledge_entry_id, submitted_by)
      where kind = 'edit' and status in ('open','returned')
    do update set
      patch = excluded.patch,
      base_version = excluded.base_version,
      work_item_id = excluded.work_item_id,
      note = excluded.note,
      actor = excluded.actor,
      turn_id = excluded.turn_id,
      status = 'open'
    returning id
  `;
  return row.id;
}

/**
 * The patch fields somebody changed on the entry after the patch was written.
 * Accepting those as they stand would undo the later edit.
 */
export async function conflictingFields(
  db: Db,
  proposal: Pick<ProposalRow, "knowledge_entry_id" | "patch" | "base_version">,
): Promise<string[]> {
  if (!proposal.patch || proposal.base_version == null) return [];
  const [row] = await db<{ columns: string[] }[]>`
    select coalesce(array_agg(distinct changed), '{}') as columns
    from library_revisions r
    cross join unnest(r.changed_fields) as changed
    where r.knowledge_entry_id = ${proposal.knowledge_entry_id}
      and r.version > ${proposal.base_version}
  `;
  const changedColumns = new Set(row.columns);
  return Object.keys(proposal.patch).filter((field) =>
    changedColumns.has(PATCH_COLUMNS[field as PatchField]),
  );
}

async function listProposalMessages(
  db: Db,
  proposalId: string,
): Promise<ProposalMessageRow[]> {
  return db<ProposalMessageRow[]>`
    select m.id, m.proposal_id, m.author_id,
           coalesce(author.display_name, author.email) as author_name,
           m.direction, m.body_text, m.created_at
    from library_proposal_messages m
    left join users author on author.id = m.author_id
    where m.proposal_id = ${proposalId}
    order by m.created_at asc
  `;
}

export async function addProposalMessage(
  db: Db,
  message: {
    proposalId: string;
    authorId: string | null;
    direction: ProposalDirection;
    body: string;
  },
): Promise<ProposalMessageRow> {
  const [row] = await db<ProposalMessageRow[]>`
    insert into library_proposal_messages (proposal_id, author_id, direction, body_text)
    values (${message.proposalId}, ${message.authorId}, ${message.direction}, ${message.body})
    returning id, proposal_id, author_id, direction, body_text, created_at
  `;
  return row;
}

/** One proposal with its thread and, while it is open, its conflicts. */
export async function getProposal(id: string): Promise<ProposalRow> {
  const [row] = await sql<ProposalRow[]>`
    select ${PROPOSAL_COLUMNS} from ${PROPOSAL_SOURCE} where p.id = ${id}
  `;
  if (!row) throw notFound(`proposal '${id}' not found`);
  const [messages, conflicts] = await Promise.all([
    listProposalMessages(sql, id),
    row.status === "open" ? conflictingFields(sql, row) : [],
  ]);
  return { ...row, messages, conflicting_fields: conflicts };
}

/** What waits in a reviewer's teams: open ones first, each group oldest first. */
export async function listProposalQueue(
  teamIds: ReviewerTeams,
): Promise<ProposalRow[]> {
  return sql<ProposalRow[]>`
    select ${PROPOSAL_COLUMNS}
    from ${PROPOSAL_SOURCE}
    where p.status = any(${pendingStatuses}) and ${curatedBy(teamIds)}
    order by array_position(${pendingStatuses}::text[], p.status), p.created_at
    limit ${QUEUE_LIMIT}
  `;
}

export async function listUnproposedDrafts(
  teamIds: ReviewerTeams,
): Promise<UnproposedDraft[]> {
  return sql<UnproposedDraft[]>`
    select e.id, e.title, e.product_id, e.team_id, e.created_by,
           coalesce(author.display_name, author.email) as author_name,
           e.updated_at
    from knowledge_entries e
    left join users author on author.id = e.created_by
    where e.status = 'draft' and ${curatedBy(teamIds)}
      and not exists (
        select 1 from library_proposals p where p.knowledge_entry_id = e.id
      )
    order by e.updated_at desc
    limit ${QUEUE_LIMIT}
  `;
}

export async function listMyProposals(userId: string): Promise<ProposalRow[]> {
  return sql<ProposalRow[]>`
    select ${PROPOSAL_COLUMNS}
    from ${PROPOSAL_SOURCE}
    where p.submitted_by = ${userId}
    order by p.updated_at desc
    limit ${OWN_PROPOSALS_LIMIT}
  `;
}

export async function entryReview(
  entryId: string,
  userId: string | null,
): Promise<EntryReview> {
  const [mine] = await sql<ProposalRow[]>`
    select ${PROPOSAL_COLUMNS}
    from ${PROPOSAL_SOURCE}
    where p.knowledge_entry_id = ${entryId} and p.submitted_by = ${userId}
      and p.status = any(${pendingStatuses})
    order by p.updated_at desc
    limit 1
  `;
  const [{ open }] = await sql<{ open: number }[]>`
    select count(*)::int as open from library_proposals
    where knowledge_entry_id = ${entryId} and status = 'open'
  `;
  return { mine: mine ?? null, open, signals: await entrySignals(entryId) };
}

/** `teamIds` empty is a person who reviews nothing. */
export async function reviewCount(
  userId: string | null,
  teamIds: ReviewerTeams,
): Promise<ReviewCount> {
  const [row] = await sql<Omit<ReviewCount, "flagged">[]>`
    select
      count(*) filter (
        where p.status = 'open' and ${curatedBy(teamIds)}
      )::int as waiting,
      count(*) filter (
        where p.status = 'returned' and p.submitted_by = ${userId}
      )::int as returned
    from library_proposals p
    join knowledge_entries e on e.id = p.knowledge_entry_id
    where p.status = any(${pendingStatuses})
  `;
  const [{ flagged }] = await sql<{ flagged: number }[]>`
    select count(*)::int as flagged
    from library_signals s
    join knowledge_entries e on e.id = s.knowledge_entry_id
    where ${listedSignal()} and ${curatedBy(teamIds)}
  `;
  return { ...row, flagged };
}
