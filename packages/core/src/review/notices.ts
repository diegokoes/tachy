import type { ProposalKind } from "@tachy/contract";
import { notify } from "../notifications/notifications";

export type ProposalEvent = "accepted" | "returned" | "rejected" | "replied";

const SUBJECTS: Record<ProposalKind, string> = {
  new: "your proposed entry",
  edit: "your proposed change",
};

function noticeTitle(kind: ProposalKind, event: ProposalEvent): string {
  if (event === "replied") return `a reviewer replied on ${SUBJECTS[kind]}`;
  if (event === "returned") return `${SUBJECTS[kind]} was sent back`;
  return `${SUBJECTS[kind]} was ${event}`;
}

export interface NoticeSubject {
  id: string;
  kind: ProposalKind;
  knowledge_entry_id: string;
  entry_title: string;
  submitted_by: string | null;
}

/** Tells the submitter what a reviewer did; nothing when they did it themselves. */
export async function notifySubmitter(
  proposal: NoticeSubject,
  event: ProposalEvent,
  by: { reviewerId: string | null; message?: string },
): Promise<void> {
  if (!proposal.submitted_by || proposal.submitted_by === by.reviewerId) return;
  await notify({
    userId: proposal.submitted_by,
    kind: "review_reply",
    title: noticeTitle(proposal.kind, event),
    body: by.message ?? proposal.entry_title,
    ref: {
      proposal_id: proposal.id,
      entry_id: proposal.knowledge_entry_id,
      event,
    },
  });
}
