import type {
  LibrarySignalKind,
  SignalRow,
  SignalTicket,
} from "@tachy/contract";

export const SIGNAL_LABELS: Record<LibrarySignalKind, string> = {
  corrected: "corrected",
  recurring: "recurring",
  rated_low: "rated low",
  source_changed: "ticket moved on",
  duplicate: "near copy",
  aged: "aged",
};

/** The kinds a ticket can settle, so the agent is offered the entry. */
const TICKET_KINDS: readonly LibrarySignalKind[] = [
  "recurring",
  "source_changed",
];

const counted = (n: number, noun: string, plural = `${noun}s`) =>
  `${n} ${n === 1 ? noun : plural}`;

function recurrenceLine(signal: SignalRow): string {
  const { reason, since_edit: sinceEdit = 0 } = signal.evidence;
  const tickets = counted(signal.score, "matching ticket");
  if (reason === "fixed") return `marked fixed, and ${tickets} arrived since`;
  if (reason === "doubtful")
    return `not sure of its cause or fix, and seen on ${tickets}`;
  if (reason === "volume")
    return `${counted(sinceEdit, "matching ticket")} since its last edit`;
  return `seen on ${counted(signal.score, "more ticket")}`;
}

/** Why the sweep holds this signal, in a line. */
export function signalLine(signal: SignalRow): string {
  const evidence = signal.evidence;
  switch (signal.kind) {
    case "corrected":
      return `${counted(signal.score, "correction")} since its last edit`;
    case "recurring":
      return recurrenceLine(signal);
    case "rated_low":
      return `rated ${evidence.rating} of 5 by ${counted(evidence.ratings ?? 0, "reader")} since its last edit`;
    case "source_changed":
      return `${counted(signal.score, "new message")} on its source ticket #${evidence.ticket?.external_id ?? ""}`;
    case "duplicate":
      return `nearly the same as "${evidence.twin?.title ?? ""}"`;
    case "aged":
      return `untouched for over a year, read ${counted(signal.score, "time")} in the last 90 days`;
  }
}

/** The tickets a signal names, whichever kind carries them. */
export function signalTickets(signal: SignalRow): SignalTicket[] {
  if (signal.evidence.tickets) return signal.evidence.tickets;
  return signal.evidence.ticket ? [signal.evidence.ticket] : [];
}

/** A ticket as `fetch_work_item` is told of it: its connection and its id there. */
export const ticketRef = (ticket: SignalTicket) =>
  `${ticket.source}:${ticket.external_id}`;

export const settledByTicket = (signal: SignalRow) =>
  TICKET_KINDS.includes(signal.kind);

export const signalPath = (id: string) => `/review/signals/${id}`;
