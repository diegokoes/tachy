import type { Snippet } from "svelte";

export type Opt = { value: string | number; label: string };

/** How a column behaves when its row is in edit mode. */
export type EditKind = "text" | "textarea" | "select" | "checkbox" | "none";

export type Column<T> = {
  key: string;
  label: string;
  /** A CSS width for <col>. Fixed tracks are what keep rows from resizing. */
  width?: string;
  align?: "start" | "end";
  /** Plain display value; ignored when `cell` is given. */
  value?: (row: T) => unknown;
  cell?: Snippet<[T]>;
  edit?: EditKind;
  options?: Opt[];
  placeholder?: string;
  required?: boolean;
  /** Per-row override — e.g. a slug that may not be changed after creation. */
  editable?: (row: T) => boolean;
};

export type Draft = Record<string, string | number | boolean | null>;

export function cellText<T>(c: Column<T>, row: T): string {
  const v = c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
  return v == null || v === "" ? "—" : String(v);
}

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
    d[c.key] = c.edit === "checkbox" ? false : c.edit === "select" ? "" : "";
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
