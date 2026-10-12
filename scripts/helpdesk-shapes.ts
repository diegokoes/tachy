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
  product_id?: number | null;
  form_id?: number | null;
  fr_escalated?: boolean;
  nr_escalated?: boolean;
  is_escalated?: boolean;
  sentiment_score?: number | null;
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

/** A checkbox left unticked holds nothing, as an empty text or list does. */
const isFilled = (value: unknown) =>
  value != null &&
  value !== "" &&
  value !== false &&
  !(Array.isArray(value) && !value.length);

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

/** Tickets, and how many of them an agent answered. */
export interface Slice {
  tickets: number;
  answered: number;
}

const DIMENSIONS = [
  "status",
  "priority",
  "type",
  "source",
  "group",
  "product",
  "form",
  "association_type",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

/** How a set of tickets spreads over its fields. */
export interface Spread {
  tickets: number;
  /** With a first response from an agent, as `stats` dates one. */
  answered: number;
  resolved: number;
  reopened: number;
  unassigned: number;
  without_company: number;
  with_tags: number;
  first_response_overdue: number;
  next_response_overdue: number;
  resolution_overdue: number;
  /** Whose subject or custom fields name a dev item as tachy reads one. */
  naming_dev_item: number;
  with_sentiment: number;
  by: Record<Dimension, Record<string, Slice>>;
}

/** The values a named field takes. */
export interface FieldValues {
  /** The tickets that hold any value in it. */
  filled: Slice;
  /** Counted up to one past the most values a field is shown with. */
  distinct: number;
  /** Per value, for a field of few short values: a field of free text has none. */
  by_value?: Record<string, Slice>;
  /** Of a field whose every value is a number. */
  quantiles?: Quantiles;
}

/** The counts a walk of the ticket listing adds up to. */
export interface TicketShapes {
  tickets: number;
  oldest_created: string | null;
  newest_created: string | null;
  /** Per month of the window: tickets created in it, and tickets resolved in it. */
  per_month: Record<string, { created: number; resolved: number }>;
  /** Tickets created in the window. */
  in_window: Spread;
  /** Listed because they changed in the window, created before it. */
  before_window: Spread;
  /** The days most tickets last changed on. A bulk change shows as one. */
  busiest_change_days: Record<string, number>;
  /**
   * Per custom field, of the window's tickets: those that hold a value in it.
   * A checkbox counts when it is ticked.
   */
  custom_fields: Record<string, number>;
  /** The same per ticket form, for the fields a form's tickets fill. */
  custom_fields_by_form: Record<string, Record<string, number>>;
  dev_item_fields: Record<string, number>;
  /** Of the window's tickets, the values of the fields asked for by name. */
  values: Record<string, FieldValues>;
  /** Per key of `stats`: tickets that hold a time in it. */
  stats_keys: Record<string, number>;
  /** Calendar hours, of the window's tickets that have the time. */
  first_response_hours: Quantiles;
  resolution_hours: Quantiles;
  top_level_keys: string[];
}

/** Past these a field is free text, and its values stay out of the report. */
const MAX_VALUES_SHOWN = 30;
const MAX_VALUE_CHARS = 40;
const BUSIEST_DAYS_SHOWN = 10;

const emptySpread = (): Spread => ({
  tickets: 0,
  answered: 0,
  resolved: 0,
  reopened: 0,
  unassigned: 0,
  without_company: 0,
  with_tags: 0,
  first_response_overdue: 0,
  next_response_overdue: 0,
  resolution_overdue: 0,
  naming_dev_item: 0,
  with_sentiment: 0,
  by: Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, {}]),
  ) as Spread["by"],
});

function addToSlice(
  slices: Record<string, Slice>,
  key: string,
  answered: boolean,
) {
  const slice = (slices[key] ??= { tickets: 0, answered: 0 });
  slice.tickets++;
  if (answered) slice.answered++;
}

const dimensionValues = (ticket: ListedTicket): Record<Dimension, unknown> => ({
  status: ticket.status,
  priority: ticket.priority,
  type: ticket.type || null,
  source: ticket.source,
  group: ticket.group_id,
  product: ticket.product_id,
  form: ticket.form_id,
  association_type: ticket.association_type,
});

const namesDevItem = (ticket: ListedTicket) =>
  extractAdoRefs({
    externalId: String(ticket.id),
    kind: "ticket",
    title: ticket.subject,
    raw: ticket,
    messages: [],
  }).length > 0;

function addToSpread(spread: Spread, ticket: ListedTicket, answered: boolean) {
  spread.tickets++;
  if (answered) spread.answered++;
  if (Number.isFinite(timeMs(ticket.stats?.resolved_at))) spread.resolved++;
  if (Number.isFinite(timeMs(ticket.stats?.reopened_at))) spread.reopened++;
  if (ticket.responder_id == null) spread.unassigned++;
  if (ticket.company_id == null) spread.without_company++;
  if (ticket.tags?.length) spread.with_tags++;
  if (ticket.fr_escalated) spread.first_response_overdue++;
  if (ticket.nr_escalated) spread.next_response_overdue++;
  if (ticket.is_escalated) spread.resolution_overdue++;
  if (ticket.sentiment_score != null) spread.with_sentiment++;
  if (namesDevItem(ticket)) spread.naming_dev_item++;
  for (const [dimension, value] of Object.entries(dimensionValues(ticket)))
    addToSlice(
      spread.by[dimension as Dimension],
      String(value ?? NONE),
      answered,
    );
}

/** The values one named field took, as they are met. */
function createValueTally() {
  const slices: Record<string, Slice> = {};
  const filled: Slice = { tickets: 0, answered: 0 };
  const numbers: number[] = [];
  let isNumeric = true;
  let isShort = true;
  return {
    add(value: unknown, answered: boolean) {
      if (!isFilled(value)) return;
      filled.tickets++;
      if (answered) filled.answered++;
      const key = String(value);
      const known = key in slices;
      // Past the cap a field is free text: its further values are not kept.
      if (!known && Object.keys(slices).length > MAX_VALUES_SHOWN) return;
      addToSlice(slices, key, answered);
      if (key.length > MAX_VALUE_CHARS) isShort = false;
      const number = typeof value === "boolean" ? Number.NaN : Number(value);
      if (Number.isFinite(number)) numbers.push(number);
      else isNumeric = false;
    },
    report(): FieldValues {
      const distinct = Object.keys(slices).length;
      const isFew = distinct <= MAX_VALUES_SHOWN;
      return {
        filled,
        distinct,
        ...(isFew && isShort ? { by_value: slices } : {}),
        ...(isNumeric && numbers.length
          ? { quantiles: quantiles(numbers) }
          : {}),
      };
    },
  };
}

/**
 * Adds tickets up as a walk reads them, one at a time: a year of a busy
 * helpdesk is not held in memory. A ticket read twice counts once, as it was
 * first read. `valueFields` names the fields whose values are reported: a
 * custom field, or a field of the ticket itself.
 */
export function createTicketTally(
  windowStart: Date,
  valueFields: string[] = [],
) {
  const seen = new Set<number>();
  const keys = new Set<string>();
  const firstResponseHours: number[] = [];
  const resolutionHours: number[] = [];
  const changedPerDay = new Map<string, number>();
  const valueTallies = new Map(
    valueFields.map((name) => [name, createValueTally()]),
  );
  let oldestMs = Number.POSITIVE_INFINITY;
  let newestMs = Number.NEGATIVE_INFINITY;
  const inWindow = emptySpread();
  const beforeWindow = emptySpread();
  const perMonth: TicketShapes["per_month"] = {};
  const customFields: Record<string, number> = {};
  const customFieldsByForm: Record<string, Record<string, number>> = {};
  const devItemFields: Record<string, number> = {};
  const statsKeys: Record<string, number> = {};

  const month = (key: string) =>
    (perMonth[key] ??= { created: 0, resolved: 0 });

  function addFields(ticket: ListedTicket, answered: boolean) {
    const form = String(ticket.form_id ?? NONE);
    for (const [name, value] of Object.entries(ticket.custom_fields ?? {})) {
      customFields[name] ??= 0;
      if (DEV_ITEM_FIELD.test(name)) devItemFields[name] ??= 0;
      if (!isFilled(value)) continue;
      customFields[name]++;
      increment((customFieldsByForm[form] ??= {}), name);
      if (DEV_ITEM_FIELD.test(name)) devItemFields[name]++;
    }
    for (const [name, values] of valueTallies)
      values.add(
        ticket.custom_fields?.[name] ??
          (ticket as unknown as Record<string, unknown>)[name],
        answered,
      );
  }

  return {
    add(ticket: ListedTicket) {
      if (seen.has(ticket.id)) return;
      seen.add(ticket.id);
      for (const key of Object.keys(ticket)) keys.add(key);
      for (const [key, value] of Object.entries(ticket.stats ?? {}))
        if (Number.isFinite(timeMs(value))) increment(statsKeys, key);

      const changedMs = timeMs(ticket.updated_at);
      if (Number.isFinite(changedMs)) {
        const day = new Date(changedMs).toISOString().slice(0, 10);
        changedPerDay.set(day, (changedPerDay.get(day) ?? 0) + 1);
      }
      const createdMs = timeMs(ticket.created_at);
      if (Number.isFinite(createdMs)) {
        oldestMs = Math.min(oldestMs, createdMs);
        newestMs = Math.max(newestMs, createdMs);
      }
      const answeredMs = timeMs(ticket.stats?.first_responded_at);
      const resolvedMs = timeMs(ticket.stats?.resolved_at);
      const answered = Number.isFinite(answeredMs);
      if (resolvedMs >= windowStart.getTime())
        month(monthOf(resolvedMs)).resolved++;

      if (!(createdMs >= windowStart.getTime())) {
        addToSpread(beforeWindow, ticket, answered);
        return;
      }
      addToSpread(inWindow, ticket, answered);
      month(monthOf(createdMs)).created++;
      if (answered) firstResponseHours.push((answeredMs - createdMs) / HOUR_MS);
      if (Number.isFinite(resolvedMs))
        resolutionHours.push((resolvedMs - createdMs) / HOUR_MS);
      addFields(ticket, answered);
    },
    report(): TicketShapes {
      const busiest = [...changedPerDay]
        .sort((a, b) => b[1] - a[1])
        .slice(0, BUSIEST_DAYS_SHOWN);
      return {
        tickets: seen.size,
        oldest_created: Number.isFinite(oldestMs)
          ? new Date(oldestMs).toISOString()
          : null,
        newest_created: Number.isFinite(newestMs)
          ? new Date(newestMs).toISOString()
          : null,
        per_month: perMonth,
        in_window: inWindow,
        before_window: beforeWindow,
        busiest_change_days: Object.fromEntries(busiest),
        custom_fields: customFields,
        custom_fields_by_form: customFieldsByForm,
        dev_item_fields: devItemFields,
        values: Object.fromEntries(
          [...valueTallies].map(([name, values]) => [name, values.report()]),
        ),
        stats_keys: statsKeys,
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
