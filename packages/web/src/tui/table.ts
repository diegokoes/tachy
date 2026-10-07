import type { Snippet } from "svelte";
import type { IconName } from "./icons";

export type Opt = { value: string | number; label: string };

/** How a column behaves in the record form. */
export type EditKind =
  "text" | "secret" | "textarea" | "select" | "checkbox" | "none";

export type Column<T> = {
  key: string;
  label: string;
  /** A CSS width for <col>. Fixed tracks are what keep rows from resizing. */
  width?: string;
  align?: "start" | "end";
  /**
   * Plain display value; ignored when `cell` is given. On an editable column
   * this also seeds the record form, so it returns the stored form: the
   * option's `value`, not its label; a boolean, not "on"/"off". What a column
   * shows differently belongs in `cell`.
   */
  value?: (row: T) => unknown;
  cell?: Snippet<[T]>;
  edit?: EditKind;
  /** A function when the choices depend on the rest of the draft. */
  options?: Opt[] | ((draft: Draft) => Opt[]);
  /** Offer a filter box on a select, for choices that run to hundreds. */
  searchable?: boolean;
  /** Shown in the empty control. Only ever an example of the *shape* of the
   *  value; what the field is for and the rules behind it go in `info`. */
  placeholder?: string | ((draft: Draft) => string);
  /** Everything the field has to say, behind an info mark beside its label.
   *  A function when it depends on another field, e.g. the source type. */
  info?: string | ((draft: Draft) => string);
  /** Track width in the form's grid. Defaults from `edit`: prose and secrets
   *  take the full row, everything else shares one. */
  span?: "half" | "full";
  /** Fields carrying the same group sit together under its label. A column
   *  list that names no groups renders as one run of fields. */
  group?: string;
  /** In the record form but not in the table, e.g. a write-only password. */
  formOnly?: boolean;
  /** Restricts the field to one of the form's two modes. */
  only?: "create" | "edit";
  /** Hides the field when the current draft does not support it. */
  visible?: (draft: Draft) => boolean;
  /** What a fresh create form starts this field at. */
  initial?: string | number | boolean;
  required?: boolean;
  /** Per-row override - e.g. a slug that may not be changed after creation. */
  editable?: (row: T) => boolean;
  /**
   * Computed from the rest of the draft while creating, never typed. Derived
   * fields render read-only; changing one afterwards is a rename, not an edit.
   */
  derive?: (draft: Draft) => string;
  /** Normalises as the user types - a label whose slug *is* its name. */
  transform?: (value: string) => string;
  /** Drawn after the control in the record form, e.g. a button acting on it. */
  aside?: Snippet<[{ draft: Draft; mode: "create" | "edit" }]>;
  /** A way out of a read-only field in edit mode, e.g. "rename…" on a slug. */
  action?: { label: string; icon?: IconName; onclick: (row: T) => void };
};

export type Draft = Record<string, string | number | boolean | null>;

export function cellText<T>(c: Column<T>, row: T): string {
  const value = c.value
    ? c.value(row)
    : (row as Record<string, unknown>)[c.key];
  return value == null || value === "" ? "-" : String(value);
}

/** Seeds the record form from a row. See the note on `Column.value`. */
export function draftFrom<T>(columns: Column<T>[], row: T): Draft {
  const draft: Draft = {};
  for (const column of columns) {
    if (!column.edit || column.edit === "none") continue;
    const value = column.value
      ? column.value(row)
      : (row as Record<string, unknown>)[column.key];
    if (column.edit === "checkbox") draft[column.key] = Boolean(value);
    else draft[column.key] = value == null ? "" : (value as string | number);
  }
  return draft;
}

export function blankDraft<T>(columns: Column<T>[]): Draft {
  const draft: Draft = {};
  for (const column of columns) {
    if (!column.edit || column.edit === "none") continue;
    draft[column.key] =
      column.initial ?? (column.edit === "checkbox" ? false : "");
  }
  return draft;
}

export function missingRequired<T>(
  columns: Column<T>[],
  draft: Draft,
): string[] {
  return columns
    .filter(
      (c) =>
        c.required &&
        c.edit &&
        c.edit !== "none" &&
        String(draft[c.key] ?? "").trim() === "",
    )
    .map((c) => c.label);
}
