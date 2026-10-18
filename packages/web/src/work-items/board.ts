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
  /** `date` holds an ISO time, `html` the field's raw HTML; `empty` holds nothing. */
  kind: "text" | "date" | "html" | "empty";
  value: string;
}

export interface ShownSections {
  /** Drawn in the item's header. */
  pinned: ShownField[];
  body: ShownField[];
  groups: { label: string | null; fields: ShownField[] }[];
}

/** Listed refs first, in the list's order; the rest keep their place after. */
export function inOrder(refs: string[], order: string[]): string[] {
  const rank = (ref: string, i: number) => {
    const listed = order.indexOf(ref);
    return listed < 0 ? order.length + i : listed;
  };
  return refs
    .map((ref, i) => ({ ref, at: rank(ref, i) }))
    .sort((a, b) => a.at - b.at)
    .map(({ ref }) => ref);
}

/**
 * The fields of an item as the board draws them: in the source form's places,
 * prose in the body and the rest in its groups, with what holds nothing left
 * out. The team's view config pins, keeps or hides fields and orders them.
 * Without a layout every field with a value is listed, prose apart.
 */
export function shownSections(reading: WorkItemReading): ShownSections {
  const { fields, layout } = reading;
  const show = layout.display?.show ?? {};
  const order = layout.display?.order ?? [];

  const shownField = (ref: string): ShownField | null => {
    if (IN_HEADER.has(ref) || show[ref] === "hidden") return null;
    const info = layout.fields[ref];
    const label = info?.name ?? ref;
    const raw = fields[ref];
    const kept = show[ref] === "always" || show[ref] === "pin";
    if (info?.type === "html" && typeof raw === "string" && raw.trim())
      return { ref, label, kind: "html", value: raw };
    const text = info?.type === "html" ? null : fieldText(raw);
    if (text == null)
      return kept ? { ref, label, kind: "empty", value: "" } : null;
    const kind = info?.type === "dateTime" ? "date" : "text";
    return { ref, label, kind, value: text };
  };
  const present = (refs: string[]) =>
    inOrder(refs, order)
      .filter((ref) => show[ref] !== "pin")
      .map(shownField)
      .filter((field): field is ShownField => field !== null);

  const pinned = inOrder(
    Object.keys(show).filter((ref) => show[ref] === "pin"),
    order,
  )
    .map(shownField)
    .filter((field): field is ShownField => field !== null);

  if (!layout.layout) {
    const every = present(Object.keys(fields));
    const rest = every.filter((field) => field.kind !== "html");
    return {
      pinned,
      body: every.filter((field) => field.kind === "html"),
      groups: rest.length ? [{ label: null, fields: rest }] : [],
    };
  }
  const placed = new Set([
    ...layout.layout.body,
    ...layout.layout.groups.flatMap((group) => group.fields),
  ]);
  const unplaced = present(
    Object.keys(show).filter(
      (ref) => show[ref] === "always" && !placed.has(ref),
    ),
  );
  const groups = [
    ...layout.layout.groups.map((group) => ({
      label: group.label,
      fields: present(group.fields),
    })),
    { label: "other fields", fields: unplaced },
  ];
  return {
    pinned,
    body: present(layout.layout.body),
    groups: groups.filter((group) => group.fields.length),
  };
}
