import type {
  LibrarySignalKind,
  ProposalPrecheck,
  ProposalStatus,
  SignalEvidence,
  SignalTicket,
} from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { pastDate, rngFor, uuidFor } from "./deterministic";
import { MEMBER_EMAIL, type SeededUser } from "./org";

const NEW_PROPOSALS = 3;

/** What the checks and the model left on the first new entry and the first edit. */
const NEW_PRECHECK: ProposalPrecheck = {
  checks: [{ code: "no_component" }, { code: "no_source" }],
  advice: {
    available: true,
    ok: false,
    suggestions: [
      "name the firmware version the fix was confirmed on",
      "quote the error code as the console shows it",
    ],
  },
};
const EDIT_PRECHECK: ProposalPrecheck = {
  checks: [],
  advice: { available: true, ok: true, suggestions: [] },
};

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

/** How many approved entries, past the ones proposals use, get a signal. */
const SIGNALS = 6;

/**
 * One signal of each kind, shaped like the sweep's. The sweep itself finds
 * little in a seed: nobody opened a ticket, so no ticket has a vector.
 */
async function seedSignals(tx: Tx): Promise<void> {
  const entries = await tx<{ id: string; title: string }[]>`
    select id, title from knowledge_entries where status = 'approved'
    order by id offset ${EDIT_SAMPLES.length} limit ${SIGNALS + 1}
  `;
  const tickets = await tx<SignalTicket[]>`
    select wi.id as work_item_id, sc.slug as source, wi.external_id,
           wi.title, wi.external_url as url
    from work_items wi
    join source_connections sc on sc.id = wi.source_connection_id
    order by wi.id limit 4
  `;
  if (entries.length <= SIGNALS || !tickets.length) return;
  const twin = entries[SIGNALS];
  const lastAt = new Date().toISOString();
  const samples: {
    kind: LibrarySignalKind;
    score: number;
    flagged?: boolean;
    evidence: SignalEvidence;
  }[] = [
    {
      kind: "corrected",
      score: 1,
      evidence: {
        notes: [
          {
            kind: "correction",
            comment: "the restart does not help on firmware 9.2 and later",
          },
        ],
      },
    },
    {
      kind: "recurring",
      score: tickets.length,
      evidence: {
        tickets,
        since_edit: tickets.length,
        last_at: lastAt,
        reason: "fixed",
      },
    },
    { kind: "rated_low", score: 3, evidence: { rating: 1.7, ratings: 3 } },
    {
      kind: "source_changed",
      score: 2,
      evidence: { messages: 2, ticket: tickets[0] },
    },
    {
      kind: "duplicate",
      score: 91,
      evidence: { twin: { id: twin.id, title: twin.title, similarity: 0.91 } },
    },
    {
      kind: "recurring",
      score: 1,
      flagged: false,
      evidence: {
        tickets: tickets.slice(0, 1),
        since_edit: 1,
        last_at: lastAt,
      },
    },
  ];
  await insertRows(
    tx,
    "library_signals",
    ["id", "knowledge_entry_id", "kind", "score", "evidence", "flagged"],
    samples.map((sample, i) => ({
      id: uuidFor("signal", i),
      knowledge_entry_id: entries[i].id,
      kind: sample.kind,
      score: sample.score,
      evidence: tx.json(sample.evidence as never),
      flagged: sample.flagged ?? true,
    })),
  );
}

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
      precheck: i === 0 ? tx.json(NEW_PRECHECK as never) : null,
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
      precheck: i === 0 ? tx.json(EDIT_PRECHECK as never) : null,
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
      "precheck",
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
  await seedSignals(tx);
}
