/**
 * What a Freshdesk helpdesk's tickets look like, in counts: the figures
 * `profile-helpdesk.ts` reports. Nothing here keeps a subject, a message, a
 * name or an address. Field names, status codes, type names and group ids are
 * the helpdesk's configuration and are reported as they are.
 */
import { extractAdoRefs } from "../packages/core/src/work-items/linked-refs";

/** The parts of a listed ticket the profile reads. */
export interface ListedTicket {
  id: number;
  subject?: string;
  status?: number | null;
  priority?: number | null;
  type?: string | null;
  source?: number | null;
  group_id?: number | null;
  responder_id?: number | null;
  company_id?: number | null;
  association_type?: number | null;
  fr_escalated?: boolean;
  is_escalated?: boolean;
  tags?: string[];
  custom_fields?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

/** The parts of a conversation the profile reads. */
export interface ListedConversation {
  user_id?: number | null;
  incoming?: boolean;
  private?: boolean;
  source?: number | null;
  automation_id?: number | null;
  auto_response?: boolean;
  body_text?: string;
}

export interface Quantiles {
  n: number;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

const HOUR_MS = 3_600_000;
const SECOND_MS = 1000;
/** A custom field named like this may hold the dev item a ticket is tracked by. */
const DEV_ITEM_FIELD = /devops|azure|(^|_)ado(_|$)|work_?item|jira|bug/i;
const NONE = "none";

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const isFilled = (value: unknown) =>
  value != null && value !== "" && !(Array.isArray(value) && !value.length);

/** A time the source gave, in ms, or NaN for one it left out. */
const timeMs = (value: unknown) =>
  typeof value === "string" ? Date.parse(value) : Number.NaN;

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** The quantile at `share` of sorted values, between the two nearest ranks. */
function quantile(sorted: number[], share: number): number | null {
  if (!sorted.length) return null;
  const rank = (sorted.length - 1) * share;
  const below = Math.floor(rank);
  const above = Math.min(below + 1, sorted.length - 1);
  const value =
    sorted[below] + (sorted[above] - sorted[below]) * (rank - below);
  return Math.round(value * 10) / 10;
}

export function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
  };
}

/** The counts a walk of the ticket listing adds up to. */
export interface TicketShapes {
  tickets: number;
  /** Listed because they changed in the window, created before it. */
  created_before_window: number;
  oldest_created: string | null;
  newest_created: string | null;
  /** Per month of the window: tickets created in it, and tickets resolved in it. */
  per_month: Record<string, { created: number; resolved: number }>;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_type: Record<string, number>;
  by_source: Record<string, number>;
  by_group: Record<string, number>;
  by_association_type: Record<string, number>;
  unassigned: number;
  without_company: number;
  with_tags: number;
  first_response_overdue: number;
  resolution_overdue: number;
  /** Per custom field: tickets that hold a value in it. */
  custom_fields: Record<string, number>;
  dev_item_fields: Record<string, number>;
  /** Tickets whose subject or custom fields name a dev item as tachy reads one. */
  naming_dev_item: number;
  /** Per key of `stats`: tickets that hold a time in it. */
  stats_keys: Record<string, number>;
  /** Calendar hours, of the window's tickets that have the time. */
  first_response_hours: Quantiles;
  resolution_hours: Quantiles;
  top_level_keys: string[];
}

/**
 * Adds tickets up as a walk reads them, one at a time: a year of a busy
 * helpdesk is not held in memory. A ticket read twice counts once, as it was
 * first read.
 */
export function createTicketTally(windowStart: Date) {
  const seen = new Set<number>();
  const keys = new Set<string>();
  const firstResponseHours: number[] = [];
  const resolutionHours: number[] = [];
  let oldestMs = Number.POSITIVE_INFINITY;
  let newestMs = Number.NEGATIVE_INFINITY;
  const shapes: Omit<
    TicketShapes,
    | "oldest_created"
    | "newest_created"
    | "first_response_hours"
    | "resolution_hours"
    | "top_level_keys"
  > = {
    tickets: 0,
    created_before_window: 0,
    per_month: {},
    by_status: {},
    by_priority: {},
    by_type: {},
    by_source: {},
    by_group: {},
    by_association_type: {},
    unassigned: 0,
    without_company: 0,
    with_tags: 0,
    first_response_overdue: 0,
    resolution_overdue: 0,
    custom_fields: {},
    dev_item_fields: {},
    naming_dev_item: 0,
    stats_keys: {},
  };

  const month = (key: string) =>
    (shapes.per_month[key] ??= { created: 0, resolved: 0 });

  function addTimes(ticket: ListedTicket) {
    const createdMs = timeMs(ticket.created_at);
    const inWindow = createdMs >= windowStart.getTime();
    if (Number.isFinite(createdMs)) {
      oldestMs = Math.min(oldestMs, createdMs);
      newestMs = Math.max(newestMs, createdMs);
    }
    if (inWindow) month(monthOf(createdMs)).created++;
    else shapes.created_before_window++;

    for (const [key, value] of Object.entries(ticket.stats ?? {}))
      if (Number.isFinite(timeMs(value))) increment(shapes.stats_keys, key);

    const resolvedMs = timeMs(ticket.stats?.resolved_at);
    if (resolvedMs >= windowStart.getTime())
      month(monthOf(resolvedMs)).resolved++;
    if (!inWindow) return;
    const answeredMs = timeMs(ticket.stats?.first_responded_at);
    if (Number.isFinite(answeredMs))
      firstResponseHours.push((answeredMs - createdMs) / HOUR_MS);
    if (Number.isFinite(resolvedMs))
      resolutionHours.push((resolvedMs - createdMs) / HOUR_MS);
  }

  function addFields(ticket: ListedTicket) {
    for (const [name, value] of Object.entries(ticket.custom_fields ?? {})) {
      shapes.custom_fields[name] ??= 0;
      if (DEV_ITEM_FIELD.test(name)) shapes.dev_item_fields[name] ??= 0;
      if (!isFilled(value)) continue;
      shapes.custom_fields[name]++;
      if (DEV_ITEM_FIELD.test(name)) shapes.dev_item_fields[name]++;
    }
    const refs = extractAdoRefs({
      externalId: String(ticket.id),
      kind: "ticket",
      title: ticket.subject,
      raw: ticket,
      messages: [],
    });
    if (refs.length) shapes.naming_dev_item++;
  }

  return {
    add(ticket: ListedTicket) {
      if (seen.has(ticket.id)) return;
      seen.add(ticket.id);
      shapes.tickets++;
      for (const key of Object.keys(ticket)) keys.add(key);
      increment(shapes.by_status, String(ticket.status ?? NONE));
      increment(shapes.by_priority, String(ticket.priority ?? NONE));
      increment(shapes.by_type, ticket.type || NONE);
      increment(shapes.by_source, String(ticket.source ?? NONE));
      increment(shapes.by_group, String(ticket.group_id ?? NONE));
      increment(
        shapes.by_association_type,
        String(ticket.association_type ?? NONE),
      );
      if (ticket.responder_id == null) shapes.unassigned++;
      if (ticket.company_id == null) shapes.without_company++;
      if (ticket.tags?.length) shapes.with_tags++;
      if (ticket.fr_escalated) shapes.first_response_overdue++;
      if (ticket.is_escalated) shapes.resolution_overdue++;
      addTimes(ticket);
      addFields(ticket);
    },
    report(): TicketShapes {
      return {
        ...shapes,
        oldest_created: Number.isFinite(oldestMs)
          ? new Date(oldestMs).toISOString()
          : null,
        newest_created: Number.isFinite(newestMs)
          ? new Date(newestMs).toISOString()
          : null,
        first_response_hours: quantiles(firstResponseHours),
        resolution_hours: quantiles(resolutionHours),
        top_level_keys: [...keys].sort(),
      };
    },
  };
}

export interface ConversationShapes {
  messages: number;
  /**
   * Per combination of who wrote it and how the source marks it. `agent` and
   * `contact` come from the agent list, `unknown` when that list is not
   * readable. A `contact` message that is not `incoming` is one tachy would
   * read as an agent's.
   */
  by_shape: Record<string, number>;
  automated: number;
  naming_dev_item: number;
  keys: string[];
}

/** How a sample of conversations is marked. `agentIds` null: the list was not readable. */
export function conversationShapes(
  conversations: (ListedConversation & Record<string, unknown>)[],
  agentIds: Set<string> | null,
): ConversationShapes {
  const shapes: ConversationShapes = {
    messages: 0,
    by_shape: {},
    automated: 0,
    naming_dev_item: 0,
    keys: [],
  };
  const keys = new Set<string>();
  for (const conversation of conversations) {
    shapes.messages++;
    for (const key of Object.keys(conversation)) keys.add(key);
    const author = authorKind(conversation, agentIds);
    increment(
      shapes.by_shape,
      `author=${author} incoming=${conversation.incoming === true} private=${conversation.private === true} source=${conversation.source ?? NONE}`,
    );
    if (conversation.automation_id != null || conversation.auto_response)
      shapes.automated++;
    const refs = extractAdoRefs({
      externalId: "",
      kind: "ticket",
      raw: {},
      messages: [
        {
          visibility: "public",
          direction: "incoming",
          bodyText: conversation.body_text ?? "",
        },
      ],
    });
    if (refs.length) shapes.naming_dev_item++;
  }
  shapes.keys = [...keys].sort();
  return shapes;
}

function authorKind(
  conversation: ListedConversation,
  agentIds: Set<string> | null,
): "agent" | "contact" | "unknown" | "none" {
  if (conversation.user_id == null) return "none";
  if (!agentIds) return "unknown";
  return agentIds.has(String(conversation.user_id)) ? "agent" : "contact";
}

/** Where a walk of the listing by change time reads next. */
export interface ListPosition {
  since: string;
  page: number;
}

/**
 * After a full page: restart a second before its last change, or page on when
 * that is no later than this start. A ticket changing during the walk then
 * cannot move an unread one onto a page already read.
 */
export function nextListPosition(
  position: ListPosition,
  tickets: ListedTicket[],
): ListPosition {
  const changedMs = tickets
    .map((ticket) => timeMs(ticket.updated_at))
    .filter(Number.isFinite);
  const restartMs =
    Math.floor(Math.max(...changedMs) / SECOND_MS) * SECOND_MS - SECOND_MS;
  if (!(restartMs > Date.parse(position.since)))
    return { ...position, page: position.page + 1 };
  return { since: new Date(restartMs).toISOString(), page: 1 };
}

/** A time as the Freshdesk reference writes one: UTC, to the second. */
export const toSecond = (isoDate: string) =>
  new Date(isoDate).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The API answers in JSON. A page comes from what stands in front of it. */
export const isApiAnswer = (contentType: string | null) =>
  /\bjson\b/i.test(contentType ?? "");

/**
 * What a helpdesk sent in place of an answer, in a line: the API's error code
 * and message, or the title of a page. Null when it sent neither.
 */
export function refusalText(body: string): string | null {
  try {
    const error = JSON.parse(body) as { code?: unknown; message?: unknown };
    const said = [error?.code, error?.message].filter(
      (part) => typeof part === "string",
    );
    if (said.length) return said.join(": ");
  } catch {
    // Not JSON: a page.
  }
  const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim();
  return title ? `a page titled "${title}"` : null;
}

/** The names of an answer's fields: of an object, or of a list's first entry. */
export function keysOf(body: unknown): string[] {
  const sample = Array.isArray(body) ? body[0] : body;
  return sample && typeof sample === "object" ? Object.keys(sample).sort() : [];
}
