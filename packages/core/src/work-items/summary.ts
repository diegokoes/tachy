import { z } from "zod";
import type { WorkItemSource } from "../sources/source";
import type { TranscriptOnTicket } from "./compact";
import type { RawMessage } from "./raw";
import {
  escapeHtml,
  mutedText,
  noteLink,
  pill,
  renderNote,
  rowsTable,
  SUMMARY_MARKER,
  textToHtml,
  type NoteCallout,
  type NoteFact,
  type NoteSection,
  type PillTone,
} from "./note-html";

export const SUMMARY_STATES = [
  "resolved",
  "waiting_customer",
  "waiting_us",
  "blocked",
  "in_progress",
] as const;

export const TRY_RESULTS = [
  "worked",
  "workaround",
  "failed",
  "ruled_out",
  "unknown",
] as const;

/**
 * What a ticket summary holds. The descriptions are the writing brief: they
 * reach the model both as the MCP tool's schema and in the flow step's prompt.
 */
export const ticketSummarySchema = z.object({
  problem: z
    .string()
    .min(1)
    .describe(
      "What the customer reported and its impact, in two to four sentences. Facts from the thread only.",
    ),
  state: z
    .enum(SUMMARY_STATES)
    .optional()
    .describe(
      "Which of these the thread shows. resolved: the customer confirmed the fix, or the ticket was closed as fixed. waiting_customer: we asked them something they have not answered. waiting_us: the next move is ours, development included. blocked: neither side can move until something outside both changes, such as a third party. in_progress: someone is working on it now.",
    ),
  status: z
    .string()
    .min(1)
    .describe(
      "Where the ticket stands now, in one or two sentences: what happened last, and who or what it waits on. state carries the category; this gives the particulars.",
    ),
  next_step: z
    .string()
    .optional()
    .describe(
      "The first thing the colleague who picks this up should do, in one sentence. Only when the thread makes it plain: a reply someone promised, a question waiting for an answer, a fix waiting for a release. Never a step of your own. Leave it out when the ticket is resolved.",
    ),
  open_questions: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Questions someone on the thread asked that nobody answered, one sentence each, worded as the asker put it. Empty when there are none.",
    ),
  timeline: z
    .array(
      z.object({
        date: z.string().describe("YYYY-MM-DD, taken from the message."),
        who: z
          .string()
          .optional()
          .describe("The person or team that acted, as named in the thread."),
        event: z.string().min(1).describe("What happened, in one sentence."),
      }),
    )
    .describe(
      "Key events, oldest first. Decisions, findings and hand-offs; not every message.",
    ),
  tried: z
    .array(
      z.object({
        action: z.string().min(1).describe("What was attempted or checked."),
        result: z
          .enum(TRY_RESULTS)
          .optional()
          .describe(
            "worked: it fixed the problem. workaround: the problem is held off but its cause remains. failed: it was tried and the problem stayed. ruled_out: it was checked and is not the cause. unknown: the thread does not say what came of it.",
          ),
        outcome: z
          .string()
          .min(1)
          .describe("Its result, or why it was ruled out."),
      }),
    )
    .describe(
      "What was already attempted or ruled out, including work tracked in linked Azure DevOps items. Empty when nothing was.",
    ),
  files: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe("The file's name, as the ticket lists it."),
        path: z
          .string()
          .optional()
          .describe(
            "The file's path from the ticket's files list, copied exactly. The note then links the name to the file, which also tells apart files that share a name.",
          ),
        from: z
          .string()
          .optional()
          .describe("Who sent it, as named in the thread."),
        date: z.string().optional().describe("YYYY-MM-DD it was sent."),
        shows: z
          .string()
          .optional()
          .describe(
            "One sentence on what it shows or holds: the error on a screenshot, what a log says at the failure. Only for a file you opened, or one the thread itself describes; leave it out otherwise.",
          ),
      }),
    )
    .default([])
    .describe(
      "The files on the ticket that bear on the problem: screenshots, logs, exports. Not signatures, logos or a mail's own images. Empty when there are none.",
    ),
});

export type TicketSummary = z.infer<typeof ticketSummarySchema>;
/** A summary as it is handed in: `files` and `open_questions` may be left out. */
export type TicketSummaryInput = z.input<typeof ticketSummarySchema>;
type SummaryState = (typeof SUMMARY_STATES)[number];
type TryResult = (typeof TRY_RESULTS)[number];

export interface SummarizedTicket {
  external_id: string;
  title?: string;
}

const STATE_LABEL: Record<SummaryState, { text: string; tone: PillTone }> = {
  resolved: { text: "Resolved", tone: "good" },
  waiting_customer: { text: "Waiting on customer", tone: "warn" },
  waiting_us: { text: "Waiting on us", tone: "info" },
  blocked: { text: "Blocked", tone: "bad" },
  in_progress: { text: "In progress", tone: "neutral" },
};

const RESULT_LABEL: Record<TryResult, { text: string; tone: PillTone }> = {
  worked: { text: "Worked", tone: "good" },
  workaround: { text: "Workaround", tone: "warn" },
  failed: { text: "Failed", tone: "bad" },
  ruled_out: { text: "Ruled out", tone: "neutral" },
  unknown: { text: "No result", tone: "neutral" },
};

const SUMMARY_CAVEAT =
  "Written by a model from the ticket thread. Check it against the thread before acting on it.";

function timelineHtml(timeline: TicketSummary["timeline"]): string {
  return rowsTable(
    timeline.map((entry) => [
      mutedText(entry.date),
      entry.who ? `<strong>${escapeHtml(entry.who)}</strong>` : "",
      escapeHtml(entry.event),
    ]),
  );
}

function triedHtml(tried: TicketSummary["tried"]): string {
  return rowsTable(
    tried.map((attempt) => {
      const result = attempt.result ? RESULT_LABEL[attempt.result] : null;
      return [
        escapeHtml(attempt.action),
        result ? pill(result.text, result.tone) : "",
        mutedText(attempt.outcome),
      ];
    }),
  );
}

/** Who sent a file and when, where the summary says. */
const sentBy = (file: TicketSummary["files"][number]) =>
  [file.from, file.date].filter(Boolean).join(", ");

/** Where a file of the ticket opens, by its reference, or null for no link. */
export type FileLinker = (path: string) => string | null;

function filesHtml(
  files: TicketSummary["files"],
  linkOf: FileLinker | undefined,
): string {
  const items = files.map((file) => {
    const sent = sentBy(file);
    const href = file.path ? linkOf?.(file.path) : null;
    const name = href ? noteLink(href, file.name) : escapeHtml(file.name);
    return (
      `<li style="margin:0 0 4px 0"><strong>${name}</strong>` +
      (sent ? ` ${mutedText(sent)}` : "") +
      (file.shows ? `<br>${escapeHtml(file.shows)}` : "") +
      "</li>"
    );
  });
  return `<ul style="margin:0 0 8px 0;padding-left:22px">${items.join("")}</ul>`;
}

export interface SummaryNoteOptions {
  /** Turns a file's path into a link; without it file names are plain. */
  linkOf?: FileLinker;
  /** The customer tachy matched the ticket to. */
  customer?: string | null;
  requestedBy?: string;
  /** The compacted transcript already on the ticket, if any. */
  transcript?: TranscriptOnTicket | null;
}

function summaryFacts(
  summary: TicketSummaryInput,
  opts: SummaryNoteOptions,
): NoteFact[] {
  const facts: NoteFact[] = [];
  if (summary.state) {
    const state = STATE_LABEL[summary.state];
    facts.push({ label: "State", html: pill(state.text, state.tone) });
  }
  if (opts.customer)
    facts.push({ label: "Customer", html: escapeHtml(opts.customer) });
  const fileCount = summary.files?.length ?? 0;
  if (fileCount) facts.push({ label: "Files", html: String(fileCount) });
  if (opts.transcript) {
    const { parts, postedAt } = opts.transcript;
    const detail = [parts > 1 ? `${parts} parts` : "", postedAt?.slice(0, 10)]
      .filter(Boolean)
      .join(", ");
    facts.push({
      label: "Full thread",
      html: `Compacted transcript${detail ? ` ${mutedText(detail)}` : ""}`,
    });
  }
  return facts;
}

function summaryCallouts(summary: TicketSummaryInput): NoteCallout[] {
  const callouts: NoteCallout[] = [];
  if (summary.next_step)
    callouts.push({ label: "Next step", html: escapeHtml(summary.next_step) });
  const questions = summary.open_questions ?? [];
  if (questions.length === 1)
    callouts.push({ label: "Open question", html: escapeHtml(questions[0]) });
  if (questions.length > 1)
    callouts.push({
      label: "Open questions",
      html: `<ul style="margin:4px 0 0 0;padding-left:20px">${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul>`,
    });
  return callouts;
}

/** The summary as one private-note body, stamped so the next one replaces it. */
export function renderSummaryHtml(
  ticket: SummarizedTicket,
  summary: TicketSummaryInput,
  opts: SummaryNoteOptions = {},
): string {
  const files = summary.files ?? [];
  const sections: NoteSection[] = [
    { label: "Problem", html: textToHtml(summary.problem) },
    { label: "Where it stands", html: textToHtml(summary.status) },
  ];
  if (summary.timeline.length)
    sections.push({ label: "Timeline", html: timelineHtml(summary.timeline) });
  if (summary.tried.length)
    sections.push({ label: "Tried", html: triedHtml(summary.tried) });
  if (files.length)
    sections.push({ label: "Files", html: filesHtml(files, opts.linkOf) });
  return renderNote({
    kind: "summary",
    externalId: ticket.external_id,
    title: ticket.title,
    requestedBy: opts.requestedBy,
    facts: summaryFacts(summary, opts),
    callouts: summaryCallouts(summary),
    sections,
    caveat: SUMMARY_CAVEAT,
  });
}

/** The summary as plain text, for a flow step that reads it. */
export function renderSummaryText(summary: TicketSummaryInput): string {
  const lines = [`Problem: ${summary.problem}`];
  if (summary.state) lines.push(`State: ${STATE_LABEL[summary.state].text}`);
  lines.push(`Status: ${summary.status}`);
  if (summary.next_step) lines.push(`Next step: ${summary.next_step}`);
  const questions = summary.open_questions ?? [];
  if (questions.length) {
    lines.push("Open questions:");
    for (const question of questions) lines.push(`- ${question}`);
  }
  if (summary.timeline.length) {
    lines.push("Timeline:");
    for (const entry of summary.timeline)
      lines.push(
        `- ${entry.date}${entry.who ? ` ${entry.who}` : ""}: ${entry.event}`,
      );
  }
  if (summary.tried.length) {
    lines.push("Tried / ruled out:");
    for (const attempt of summary.tried) {
      const result = attempt.result
        ? ` (${RESULT_LABEL[attempt.result].text})`
        : "";
      lines.push(`- ${attempt.action} -> ${attempt.outcome}${result}`);
    }
  }
  const files = summary.files ?? [];
  if (files.length) {
    lines.push("Files:");
    for (const file of files) {
      const sent = sentBy(file);
      lines.push(
        `- ${file.name}${sent ? ` (${sent})` : ""}${file.shows ? `: ${file.shows}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/** Source ids of the summaries an earlier run posted on this ticket. */
export function priorSummaryIds(messages: RawMessage[]): string[] {
  return messages
    .filter((message) => message.bodyText.includes(SUMMARY_MARKER))
    .flatMap((message) => (message.externalId ? [message.externalId] : []));
}

export interface ReplacedNotes {
  notes: number;
  replaced_previous?: number;
}

/**
 * Posts `bodies` as private notes, then deletes `priorIds`. The order matters:
 * an earlier note goes only once its replacement is on the ticket. A note that
 * cannot be deleted is left in place and not counted.
 */
export async function replaceNotes(
  source: Pick<WorkItemSource, "postNote" | "deleteNote">,
  externalId: string,
  bodies: string[],
  priorIds: string[],
): Promise<ReplacedNotes> {
  if (!source.postNote) throw new Error("source does not support notes");
  for (const body of bodies)
    await source.postNote(externalId, body, { private: true });
  const posted: ReplacedNotes = { notes: bodies.length };
  if (!source.deleteNote) return posted;
  let replaced = 0;
  for (const id of priorIds)
    await source.deleteNote(id).then(
      () => replaced++,
      () => {},
    );
  if (replaced) posted.replaced_previous = replaced;
  return posted;
}
