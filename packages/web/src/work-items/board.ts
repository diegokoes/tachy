import type {
  WorkItemReading,
  WorkItemScope,
  WorkItemSort,
} from "@tachy/contract";

/** The board's one source so far; Freshdesk takes a key of its own. */
export const BOARD_SOURCE = "azure-devops";

export const boardListPath = (projectId: string) =>
  `/board/${BOARD_SOURCE}/${projectId}`;

export const BOARD_NEW_PATH = `/board/${BOARD_SOURCE}/new`;

export const boardItemPath = (projectId: string, itemId: string) =>
  `/board/${BOARD_SOURCE}/${projectId}/${itemId}`;

export interface BoardFilter {
  sort: WorkItemSort;
  direction: "asc" | "desc";
  scope: WorkItemScope;
  type: string;
  state: string;
  text: string;
}

export const DEFAULT_FILTER: BoardFilter = {
  sort: "changed",
  direction: "desc",
  scope: "all",
  type: "",
  state: "",
  text: "",
};

const NEWEST_FIRST: readonly WorkItemSort[] = ["changed", "created", "id"];

/** The same column flips its direction; a new one starts newest or A first. */
export function sortBy(
  filter: BoardFilter,
  sort: WorkItemSort,
): Pick<BoardFilter, "sort" | "direction"> {
  if (filter.sort === sort)
    return { sort, direction: filter.direction === "asc" ? "desc" : "asc" };
  return { sort, direction: NEWEST_FIRST.includes(sort) ? "desc" : "asc" };
}

export function itemsPath(
  projectId: string,
  filter: BoardFilter,
  offset: number,
  limit: number,
): string {
  const params = new URLSearchParams({
    sort: filter.sort,
    direction: filter.direction,
    scope: filter.scope,
    offset: String(offset),
    limit: String(limit),
  });
  if (filter.type) params.set("type", filter.type);
  if (filter.state) params.set("state", filter.state);
  const text = filter.text.trim();
  if (text) params.set("q", text);
  return `/work-items/projects/${projectId}/items?${params.toString()}`;
}

/** A field's value as one line of text, or null when it holds nothing. */
export function fieldText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    const { displayName, uniqueName } = value as Record<string, unknown>;
    const person = displayName ?? uniqueName;
    return typeof person === "string" ? person : JSON.stringify(value);
  }
  return String(value);
}

/** Drawn in the item's header, so left out of its field groups. */
const IN_HEADER = new Set([
  "System.Title",
  "System.State",
  "System.AssignedTo",
  "System.WorkItemType",
]);

export interface ShownField {
  ref: string;
  label: string;
  /** `date` holds an ISO time; `html` holds the field's raw HTML. */
  kind: "text" | "date" | "html";
  value: string;
}

export interface ShownSections {
  body: ShownField[];
  groups: { label: string | null; fields: ShownField[] }[];
}

/**
 * The fields of an item that hold something, in the source form's places:
 * prose in the body, the rest in its groups. Without a layout every field
 * with a value is listed, prose apart.
 */
export function shownSections(reading: WorkItemReading): ShownSections {
  const { fields, layout } = reading;
  const shown = (ref: string): ShownField | null => {
    if (IN_HEADER.has(ref)) return null;
    const info = layout.fields[ref];
    const label = info?.name ?? ref;
    const raw = fields[ref];
    if (info?.type === "html")
      return typeof raw === "string" && raw.trim()
        ? { ref, label, kind: "html", value: raw }
        : null;
    const text = fieldText(raw);
    if (text == null) return null;
    return {
      ref,
      label,
      kind: info?.type === "dateTime" ? "date" : "text",
      value: text,
    };
  };
  const present = (refs: string[]) =>
    refs.map(shown).filter((field): field is ShownField => field !== null);

  if (layout.layout) {
    return {
      body: present(layout.layout.body),
      groups: layout.layout.groups
        .map((group) => ({ label: group.label, fields: present(group.fields) }))
        .filter((group) => group.fields.length),
    };
  }
  const every = present(Object.keys(fields));
  const rest = every.filter((field) => field.kind !== "html");
  return {
    body: every.filter((field) => field.kind === "html"),
    groups: rest.length ? [{ label: null, fields: rest }] : [],
  };
}
