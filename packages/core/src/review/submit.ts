import {
  PENDING_PROPOSAL_STATUSES,
  SEARCHED_ENTRY_STATUSES,
  type Submission,
} from "@tachy/contract";
import { canPropose } from "../access/permissions";
import { sql } from "../infra/db";
import type { Db } from "../infra/db";
import { badInput, conflict, forbidden, notFound } from "../infra/errors";
import {
  assertKnowledgeUpdateApplies,
  insertKnowledgeEntry,
  prepareKnowledgeEntry,
  updateKnowledgeEntry,
  type KnowledgeInput,
  type KnowledgeUpdateInput,
  type PreparedEntry,
} from "../knowledge/knowledge";
import type { ActorRef } from "../library/revisions";
import { runProposalChecks } from "./precheck";
import { upsertProposal } from "./proposals";

const pendingStatuses: string[] = [...PENDING_PROPOSAL_STATUSES];
const liveStatuses: readonly string[] = SEARCHED_ENTRY_STATUSES;

/** The one status a proposed edit may ask for; the rest are a reviewer's. */
const PROPOSABLE_STATUS = "deprecated";

export interface Submitter {
  actor: ActorRef;
  /** Whether the caller holds edit rights on the item's scope; the door decides. */
  canEdit: boolean;
  /** Why the change is proposed. Kept on the proposal, dropped on a direct write. */
  note?: string | null;
}

async function proposerId(submitter: Submitter): Promise<string> {
  const userId = submitter.actor.userId;
  if (!userId || !(await canPropose(userId)))
    throw forbidden("proposing a change needs a signed-in account");
  return userId;
}

/** Saves the entry for an editor; for anyone else, stores it as a draft to review. */
export async function saveOrProposeEntry(
  input: KnowledgeInput,
  submitter: Submitter,
): Promise<Submission> {
  return insertOrProposeEntry(await prepareKnowledgeEntry(input), submitter);
}

export async function insertOrProposeEntry(
  prepared: PreparedEntry,
  submitter: Submitter,
): Promise<Submission> {
  if (submitter.canEdit)
    return { ...(await insertKnowledgeEntry(prepared)), proposed: false };
  const userId = await proposerId(submitter);
  const draft: PreparedEntry = {
    ...prepared,
    input: {
      ...prepared.input,
      status: "draft",
      createdById: userId,
      actor: submitter.actor,
    },
  };
  return sql.begin(async (tx) => {
    const entry = await insertKnowledgeEntry(draft, tx);
    const proposalId = await upsertProposal(tx, {
      entryId: entry.id,
      kind: "new",
      workItemId: prepared.input.workItemId,
      note: submitter.note,
      submittedBy: userId,
      actor: submitter.actor.actor,
      turnId: submitter.actor.turnId,
    });
    await runProposalChecks(tx, proposalId);
    return { ...entry, proposed: true, proposal_id: proposalId };
  });
}

async function ownPendingDraft(
  db: Db,
  entryId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db<{ id: string }[]>`
    select id from library_proposals
    where knowledge_entry_id = ${entryId} and submitted_by = ${userId}
      and kind = 'new' and status = any(${pendingStatuses})
  `;
  return row?.id ?? null;
}

function proposedFields(patch: KnowledgeUpdateInput): Record<string, unknown> {
  const {
    expectedVersion: _expectedVersion,
    workItemId: _workItemId,
    ...fields
  } = patch;
  if (!Object.keys(fields).length) throw badInput("the change is empty");
  if (fields.status !== undefined && fields.status !== PROPOSABLE_STATUS)
    throw badInput(
      `a proposed change may set status to '${PROPOSABLE_STATUS}' only`,
    );
  return fields;
}

/**
 * Updates the entry for an editor. Anyone else edits their own waiting draft in
 * place, or leaves a live entry untouched and stores the change as a proposal.
 */
export async function updateOrProposeEntry(
  id: string,
  patch: KnowledgeUpdateInput,
  submitter: Submitter,
): Promise<Submission> {
  if (submitter.canEdit)
    return {
      ...(await updateKnowledgeEntry(id, patch, submitter.actor)),
      proposed: false,
    };
  const userId = await proposerId(submitter);
  const [entry] = await sql<{ status: string; version: number }[]>`
    select status, version from knowledge_entries where id = ${id}
  `;
  if (!entry) throw notFound(`knowledge entry '${id}' not found`);

  if (entry.status === "draft") {
    const proposalId = await ownPendingDraft(sql, id, userId);
    if (!proposalId) throw forbidden("this draft is someone else's to edit");
    if (patch.status !== undefined && patch.status !== "draft")
      throw badInput("a draft's status is the reviewer's to set");
    const updated = await updateKnowledgeEntry(id, patch, submitter.actor);
    await runProposalChecks(sql, proposalId);
    return { ...updated, proposed: true, proposal_id: proposalId };
  }
  if (!liveStatuses.includes(entry.status))
    throw forbidden(
      `an entry that is ${entry.status} takes no proposed changes`,
    );

  const fields = proposedFields(patch);
  await assertKnowledgeUpdateApplies(id, patch);
  const proposalId = await upsertProposal(sql, {
    entryId: id,
    kind: "edit",
    patch: fields,
    baseVersion: patch.expectedVersion ?? entry.version,
    workItemId: patch.workItemId,
    note: submitter.note,
    submittedBy: userId,
    actor: submitter.actor.actor,
    turnId: submitter.actor.turnId,
  });
  await runProposalChecks(sql, proposalId);
  return {
    id,
    status: entry.status,
    version: entry.version,
    proposed: true,
    proposal_id: proposalId,
  };
}

interface OwnProposal {
  kind: string;
  status: string;
  knowledge_entry_id: string;
}

async function lockOwnProposal(
  db: Db,
  id: string,
  userId: string,
): Promise<OwnProposal> {
  const [proposal] = await db<(OwnProposal & { submitted_by: string })[]>`
    select kind, status, knowledge_entry_id, submitted_by
    from library_proposals where id = ${id} for update
  `;
  if (!proposal) throw notFound(`proposal '${id}' not found`);
  if (proposal.submitted_by !== userId)
    throw forbidden("this proposal is someone else's");
  return proposal;
}

/** Puts a proposal the reviewer sent back in front of them again. */
export async function resubmitProposal(
  id: string,
  userId: string,
  note?: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    const proposal = await lockOwnProposal(tx, id, userId);
    if (proposal.status !== "returned")
      throw conflict(`this proposal is ${proposal.status}, not sent back`);
    await tx`
      update library_proposals
      set status = 'open', note = coalesce(${note ?? null}, note)
      where id = ${id}
    `;
    await runProposalChecks(tx, id);
  });
}

/** Takes a waiting proposal back. The draft of a new entry is archived with it. */
export async function withdrawProposal(
  id: string,
  submitter: ActorRef & { userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const proposal = await lockOwnProposal(tx, id, submitter.userId);
    if (!pendingStatuses.includes(proposal.status))
      throw conflict(`this proposal is already ${proposal.status}`);
    if (proposal.kind === "new")
      await updateKnowledgeEntry(
        proposal.knowledge_entry_id,
        { status: "archived" },
        submitter,
        tx,
      );
    await tx`update library_proposals set status = 'withdrawn' where id = ${id}`;
  });
}
