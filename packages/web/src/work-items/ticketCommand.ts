/** The commands that take one help desk ticket, looked up as it is typed. */
export const TICKET_COMMANDS = ["analyze", "compact", "summary"] as const;
export type TicketCommandName = (typeof TICKET_COMMANDS)[number];

export interface TicketLine {
  name: TicketCommandName;
  /** Digits only; empty while nothing is typed yet. */
  id: string;
  /** Flags after the id as typed, e.g. ` --no-note`. */
  flags: string;
}

const TICKET_LINE_RE =
  /^\/(analyze|compact|summary)(?:[ \t]+#?(\d*)((?:[ \t]+--[a-z-]+)*))?[ \t]*$/;

/** Null for any other line, a ticket line with prose after the id included. */
export function parseTicketLine(input: string): TicketLine | null {
  const match = input.match(TICKET_LINE_RE);
  if (!match) return null;
  return {
    name: match[1] as TicketCommandName,
    id: match[2] ?? "",
    flags: match[3] ?? "",
  };
}

/** `<source> <id> [flags]` when the lookup named the source, else the id alone. */
export function ticketArgs(
  line: TicketLine,
  sourceSlug: string | null,
): string {
  return [sourceSlug, line.id, line.flags.trim()].filter(Boolean).join(" ");
}
