import type { ProposalRow } from "@tachy/contract";
import { sql } from "../infra/db";
import type { Db } from "../infra/db";
import { conflict, notFound } from "../infra/errors";
import {
  updateKnowledgeEntry,
  type KnowledgeUpdateInput,
} from "../knowledge/knowledge";
import type { ActorRef } from "../library/revisions";
import { notifySubmitter, type NoticeSubject } from "./notices";
import {
  addProposalMessage,
  conflictingFields,
  getProposal,
} from "./proposals";

type OpenProposal = NoticeSubject & Pick<ProposalRow, "patch" | "base_version">;

/** The proposal, row-locked, so two reviewers cannot both decide it. */
async function lockOpenProposal(db: Db, id: string): Promise<OpenProposal> {
  const [proposal] = await db<(OpenProposal & { status: string })[]>`
    select p.id, p.kind, p.status, p.knowledge_entry_id, p.patch, p.base_version,
           p.submitted_by, e.title as entry_title
    from library_proposals p
    join knowledge_entries e on e.id = p.knowledge_entry_id
    where p.id = ${id}
    for update of p
  `;
  if (!proposal) throw notFound(`proposal '${id}' not found`);
  if (proposal.status !== "open")
    throw conflict(`this proposal is ${proposal.status}, not open`);
  return proposal;
}

async function stampDecision(
  db: Db,
  id: string,
  decision: {
    status: "accepted" | "rejected";
    by: string | null;
    version?: number;
  },
): Promise<void> {
  await db`
    update library_proposals
    set status = ${decision.status}, decided_by = ${decision.by},
        decided_at = now(), accepted_version = ${decision.version ?? null}
    where id = ${id}
  `;
}

/**
 * What accepting writes to the entry. A reviewer's own `edits` replace the
 * proposed patch; without them, a patch that overlaps a later edit is refused,
 * with the overlapping fields in the error's `fields`.
 */
async function acceptedChange(
  db: Db,
  proposal: OpenProposal,
  edits: KnowledgeUpdateInput | undefined,
): Promise<KnowledgeUpdateInput> {
  if (proposal.kind === "new") return { ...edits, status: "approved" };
  if (edits) return edits;
  const fields = await conflictingFields(db, proposal);
  if (fields.length)
    throw conflict(
      `the entry changed since this was proposed: ${fields.join(", ")}`,
      { fields },
    );
  return proposal.patch as KnowledgeUpdateInput;
}

export async function acceptProposal(
  id: string,
  reviewer: ActorRef,
  edits?: KnowledgeUpdateInput,
): Promise<ProposalRow> {
  const accepted = await sql.begin(async (tx) => {
    const proposal = await lockOpenProposal(tx, id);
    const entry = await updateKnowledgeEntry(
      proposal.knowledge_entry_id,
      await acceptedChange(tx, proposal, edits),
      reviewer,
      tx,
    );
    await stampDecision(tx, id, {
      status: "accepted",
      by: reviewer.userId ?? null,
      version: entry.version,
    });
    return proposal;
  });
  await notifySubmitter(accepted, "accepted", {
    reviewerId: reviewer.userId ?? null,
  });
  return getProposal(id);
}

/** Hands the proposal back to its submitter with what to change. */
export async function returnProposal(
  id: string,
  reviewer: ActorRef,
  message: string,
): Promise<ProposalRow> {
  const returned = await sql.begin(async (tx) => {
    const proposal = await lockOpenProposal(tx, id);
    await tx`update library_proposals set status = 'returned' where id = ${id}`;
    await addProposalMessage(tx, {
      proposalId: id,
      authorId: reviewer.userId ?? null,
      direction: "reviewer",
      body: message,
    });
    return proposal;
  });
  await notifySubmitter(returned, "returned", {
    reviewerId: reviewer.userId ?? null,
    message,
  });
  return getProposal(id);
}

/** A rejected new entry moves to 'rejected'; a rejected edit leaves the entry as it is. */
export async function rejectProposal(
  id: string,
  reviewer: ActorRef,
  message: string,
): Promise<ProposalRow> {
  const rejected = await sql.begin(async (tx) => {
    const proposal = await lockOpenProposal(tx, id);
    if (proposal.kind === "new")
      await updateKnowledgeEntry(
        proposal.knowledge_entry_id,
        { status: "rejected" },
        reviewer,
        tx,
      );
    await stampDecision(tx, id, {
      status: "rejected",
      by: reviewer.userId ?? null,
    });
    await addProposalMessage(tx, {
      proposalId: id,
      authorId: reviewer.userId ?? null,
      direction: "reviewer",
      body: message,
    });
    return proposal;
  });
  await notifySubmitter(rejected, "rejected", {
    reviewerId: reviewer.userId ?? null,
    message,
  });
  return getProposal(id);
}

/** A message on the thread with no decision; a reviewer's reaches the submitter's inbox. */
export async function replyOnProposal(
  proposal: ProposalRow,
  author: { userId: string | null; direction: "reviewer" | "submitter" },
  message: string,
) {
  const posted = await addProposalMessage(sql, {
    proposalId: proposal.id,
    authorId: author.userId,
    direction: author.direction,
    body: message,
  });
  if (author.direction === "reviewer")
    await notifySubmitter(proposal, "replied", {
      reviewerId: author.userId,
      message,
    });
  return posted;
}
