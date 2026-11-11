import type { ProposalStatus } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { pastDate, rngFor, uuidFor } from "./deterministic";
import { MEMBER_EMAIL, type SeededUser } from "./org";

const NEW_PROPOSALS = 3;

interface EditSample {
  status: ProposalStatus;
  patch: Record<string, unknown>;
  note: string;
  /** What the reviewer wrote when returning or rejecting it. */
  reply?: string;
}

const EDIT_SAMPLES: EditSample[] = [
  {
    status: "open",
    patch: { resolution: "Clear the queue first, then restart the service." },
    note: "the restart alone did not hold on two later tickets",
  },
  {
    status: "open",
    patch: { tags: ["regression", "needs-fix-version"] },
    note: "came back after the last release",
  },
  {
    status: "open",
    patch: { status: "deprecated" },
    note: "the component was replaced, this no longer applies",
  },
  {
    status: "returned",
    patch: { rootCause: "A stale lock file left behind by the updater." },
    note: "found the cause while working a new case",
    reply: "which file, and on which version did you see it?",
  },
  {
    status: "accepted",
    patch: { confidence: "high" },
    note: "confirmed by the vendor",
  },
  {
    status: "rejected",
    patch: { resolution: "Reinstall the client." },
    note: "worked for one customer",
    reply: "a reinstall hides the cause; the entry's fix is the supported one",
  },
];

const REPLY_TITLES: Partial<Record<ProposalStatus, string>> = {
  returned: "your proposed change was sent back",
  rejected: "your proposed change was rejected",
  accepted: "your proposed change was accepted",
};

/**
 * A review queue to look at: the dev member's proposals in every state, each
 * decided one with the notice its decision raised.
 */
export async function seedReview(tx: Tx, users: SeededUser[]): Promise<void> {
  const submitter = users.find((user) => user.email === MEMBER_EMAIL);
  const reviewer = users.find((user) => user.role === "admin");
  if (!submitter || !reviewer) return;

  const drafts = await tx<{ id: string }[]>`
    select id from knowledge_entries where status = 'draft'
    order by id limit ${NEW_PROPOSALS}
  `;
  const live = await tx<{ id: string; version: number; title: string }[]>`
    select id, version, title from knowledge_entries where status = 'approved'
    order by id limit ${EDIT_SAMPLES.length}
  `;

  const proposals: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];

  drafts.forEach((draft, i) => {
    const submittedAt = pastDate(rngFor("proposal-new", i), 14);
    proposals.push({
      id: uuidFor("proposal-new", i),
      knowledge_entry_id: draft.id,
      kind: "new",
      status: "open",
      note: "written up from a ticket closed this week",
      submitted_by: submitter.id,
      actor: i === 0 ? "agent" : "web",
      created_at: submittedAt,
      updated_at: submittedAt,
    });
  });

  live.forEach((entry, i) => {
    const sample = EDIT_SAMPLES[i];
    const id = uuidFor("proposal-edit", i);
    const submittedAt = pastDate(rngFor("proposal-edit", i), 21);
    const decided = sample.status !== "open" && sample.status !== "returned";
    proposals.push({
      id,
      knowledge_entry_id: entry.id,
      kind: "edit",
      status: sample.status,
      patch: tx.json(sample.patch as never),
      base_version: entry.version,
      note: sample.note,
      submitted_by: submitter.id,
      actor: "web",
      decided_by: decided ? reviewer.id : null,
      decided_at: decided ? submittedAt : null,
      accepted_version: sample.status === "accepted" ? entry.version : null,
      created_at: submittedAt,
      updated_at: submittedAt,
    });
    if (sample.reply)
      messages.push({
        id: uuidFor("proposal-msg", i),
        proposal_id: id,
        author_id: reviewer.id,
        direction: "reviewer",
        body_text: sample.reply,
        created_at: submittedAt,
      });
    const title = REPLY_TITLES[sample.status];
    if (title)
      notifications.push({
        id: uuidFor("proposal-notif", i),
        user_id: submitter.id,
        kind: "review_reply",
        title,
        body_text: sample.reply ?? entry.title,
        ref: tx.json({
          proposal_id: id,
          entry_id: entry.id,
          event: sample.status,
        }),
        created_at: submittedAt,
      });
  });

  await insertRows(
    tx,
    "library_proposals",
    [
      "id",
      "knowledge_entry_id",
      "kind",
      "status",
      "patch",
      "base_version",
      "note",
      "submitted_by",
      "actor",
      "decided_by",
      "decided_at",
      "accepted_version",
      "created_at",
      "updated_at",
    ],
    proposals,
  );
  await insertRows(
    tx,
    "library_proposal_messages",
    ["id", "proposal_id", "author_id", "direction", "body_text", "created_at"],
    messages,
  );
  await insertRows(
    tx,
    "notifications",
    ["id", "user_id", "kind", "title", "body_text", "ref", "created_at"],
    notifications,
  );
}
