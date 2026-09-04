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
   * Plain display value; ignored when `cell` is given.
   *
   * On an editable column this is also what seeds the record form, so it must
   * return the **stored** form — the option's `value`, not its label; a boolean,
   * not "on"/"off". Anything a column wants to *show* differently belongs in
   * `cell`. Returning a label here put "Freshdesk" where "freshdesk" was
   * expected and crashed the source form on open, and made every edit of a
   * connection turn its redaction flag on.
   */
  value?: (row: T) => unknown;
  cell?: Snippet<[T]>;
  edit?: EditKind;
  /** A function when the choices depend on the rest of the draft. */
  options?: Opt[] | ((d: Draft) => Opt[]);
  /** Shown in the empty control. Only ever an example of the *shape* of the
   *  value; what the field is for and the rules behind it go in `info`. */
  placeholder?: string | ((d: Draft) => string);
  /** Everything the field has to say, behind an info mark beside its label.
   *  A function when it depends on another field, e.g. the source type. */
  info?: string | ((d: Draft) => string);
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
  visible?: (d: Draft) => boolean;
  /** What a fresh create form starts this field at. */
  initial?: string | number | boolean;
  required?: boolean;
  /** Per-row override — e.g. a slug that may not be changed after creation. */
  editable?: (row: T) => boolean;
  /**
   * Computed from the rest of the draft while creating, never typed. Derived
   * fields render read-only; changing one afterwards is a rename, not an edit.
   */
  derive?: (d: Draft) => string;
  /** Normalises as the user types — a label whose slug *is* its name. */
  transform?: (v: string) => string;
  /** A way out of a read-only field in edit mode, e.g. "rename…" on a slug. */
  action?: { label: string; icon?: IconName; onclick: (row: T) => void };
};

export type Draft = Record<string, string | number | boolean | null>;

export function cellText<T>(c: Column<T>, row: T): string {
  const v = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
  return v == null || v === "" ? "—" : String(v);
}

/** Seeds the record form from a row. See the note on `Column.value`. */
export function draftFrom<T>(columns: Column<T>[], row: T): Draft {
  const d: Draft = {};
  for (const c of columns) {
    if (!c.edit || c.edit === "none") continue;
    const v = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
    d[c.key] =
      c.edit === "checkbox"
        ? Boolean(v)
        : v == null
          ? ""
          : (v as string | number);
  }
  return d;
}

export function blankDraft<T>(columns: Column<T>[]): Draft {
  const d: Draft = {};
  for (const c of columns) {
    if (!c.edit || c.edit === "none") continue;
    d[c.key] = c.initial ?? (c.edit === "checkbox" ? false : "");
  }
  return d;
}

export function missingRequired<T>(columns: Column<T>[], d: Draft): string[] {
  return columns
    .filter(
      (c) =>
        c.required &&
        c.edit &&
        c.edit !== "none" &&
        String(d[c.key] ?? "").trim() === "",
    )
    .map((c) => c.label);
}
