import type {
  StoredItemEvent,
  StoredItemMessage,
  StoredItemRow,
} from "@tachy/contract";

export interface StoredListFilter {
  query: string;
  /** A connection's slug, or empty for every connection. */
  connection: string;
}

/** The list request for a filter, past the rows already shown. */
export function storedListPath(
  filter: StoredListFilter,
  offset: number,
): string {
  const params = new URLSearchParams();
  const query = filter.query.trim();
  if (query) params.set("q", query);
  if (filter.connection) params.set("connection", filter.connection);
  if (offset) params.set("offset", String(offset));
  const search = params.toString();
  return `/work-items/stored${search ? `?${search}` : ""}`;
}

/** A source's own field name, as ADO spells one. Tachy's words have no dot. */
const isSourceField = (field: string) => field.includes(".");

/**
 * An event as one line: `status 2 → 4`, `resolved`, `link added: Related #10`.
 * A source field with neither value was prose, left out when it was stored.
 */
export function eventLine(event: StoredItemEvent): string {
  const { old_value: was, new_value: now } = event;
  const field = event.field.replaceAll("_", " ");
  if (event.field === "link")
    return now == null ? `link removed: ${was}` : `link added: ${now}`;
  if (was == null && now == null)
    return isSourceField(event.field) ? `${field} changed` : field;
  if (was == null) return `${field} set to ${now}`;
  if (now == null) return `${field} cleared, was ${was}`;
  return `${field} ${was} → ${now}`;
}

/** Who a message is from, as far as the copy says. */
export function senderOf(message: StoredItemMessage): string {
  return message.author_label ?? message.author ?? "unknown sender";
}

/** The facts of an item worth a line each, skipping what the source left empty. */
export function itemFacts(item: StoredItemRow): [string, string][] {
  const facts: [string, string | null][] = [
    ["source", item.connection],
    ["status", item.status],
    ["type", item.item_type],
    ["priority", item.priority],
    ["group", item.group],
    ["assignee", item.assignee],
    ["requester", item.requester],
    ["customer", item.customer],
    ["product", item.product],
    ["team", item.team],
    ["project", item.project],
  ];
  return facts.filter((fact): fact is [string, string] => Boolean(fact[1]));
}
