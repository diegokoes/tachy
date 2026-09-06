/**
 * The shape of a table export and the rules for naming its file and its
 * columns. The editor in the SPA previews all three; the server applies them
 * for real. They were two implementations until this package existed, and the
 * preview was only accidentally the name the download got.
 */

export const TABLE_CELL_TYPES = [
  "string",
  "number",
  "date",
  "boolean",
] as const;
export type TableCellType = (typeof TABLE_CELL_TYPES)[number];

export const TABLE_FORMATS = ["xlsx", "csv"] as const;
export type TableFormat = (typeof TABLE_FORMATS)[number];

export interface TableColumn {
  key: string;
  label?: string;
  type: TableCellType;
  required?: boolean;
  description?: string;
}

export interface TableOutput {
  format: TableFormat;
  sheet?: string;
  filename?: string;
  columns: TableColumn[];
}

/** What the workbook's tab is called when nobody names it. */
export const DEFAULT_SHEET = "Sheet1";

const SHEET_FORBIDDEN = /[[\]:*?/\\]/g;
const FILE_FORBIDDEN = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

const MAX_SHEET = 31;
const MAX_FILENAME = 180;

/**
 * The character rules alone, with no fallback for an empty result — what an
 * input field needs while someone is still typing into it. `sheetName` and
 * `safeFilename` are these plus the fallback, for the value that is finally
 * used.
 */
export const stripSheetChars = (s: string) =>
  s.replace(SHEET_FORBIDDEN, " ").slice(0, MAX_SHEET);

export const stripFilenameChars = (s: string) =>
  s
    .replace(CONTROL_CHARS, "")
    .replace(FILE_FORBIDDEN, "-")
    .slice(0, MAX_FILENAME);

/** Excel rejects `[]:*?/\` in sheet names and truncates past 31 chars. */
export function sheetName(name: string | undefined): string {
  const cleaned = (name ?? DEFAULT_SHEET)
    .replace(SHEET_FORBIDDEN, " ")
    .trim()
    .slice(0, MAX_SHEET);
  return cleaned || DEFAULT_SHEET;
}

/** `basename`, without `node:path` — this file is bundled into the browser. */
const basename = (path: string) =>
  path.replace(/\/+$/, "").split("/").pop() ?? "";

/**
 * A name safe to write to disk and to put in a Content-Disposition header, on
 * Windows as well as here. Strips any directory the caller thought it was
 * choosing, so `../../etc/passwd` saves as `passwd`.
 */
export function safeFilename(name: string): string {
  const cleaned = basename(name)
    .replace(CONTROL_CHARS, "")
    .replace(FILE_FORBIDDEN, "-")
    .trim()
    .slice(0, MAX_FILENAME);
  return cleaned || "download";
}

/**
 * The download's name: the author's template with `{date}`/`{slug}` filled in,
 * the extension added if they left it off, and then sanitised.
 */
export function outputFilename(
  output: Pick<TableOutput, "filename" | "format">,
  fallback: string,
): string {
  const base = (output.filename ?? `${fallback}-{date}`)
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
    .replace(/\{slug\}/g, fallback);
  return safeFilename(
    base.toLowerCase().endsWith(`.${output.format}`)
      ? base
      : `${base}.${output.format}`,
  );
}

/** The heading a column is shown under — its label, or its key if unlabelled. */
export const columnHeading = (c: Pick<TableColumn, "key" | "label">) =>
  (c.label ?? "").trim() || c.key.trim();

export const fieldName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** The names the agent fills, derived from the headings and unique per sheet. */
export function columnKeys(
  columns: Pick<TableColumn, "key" | "label">[],
): string[] {
  const seen = new Set<string>();
  return columns.map((c) => {
    const base = fieldName(c.key.trim() || columnHeading(c));
    if (!base) return "";
    let key = base;
    for (let n = 2; seen.has(key); n++) key = `${base}_${n}`;
    seen.add(key);
    return key;
  });
}

/**
 * Tools an artifact may pre-authorise, so that attaching one does not put up a
 * review box for the very thing it exists to do. Enumerated rather than free
 * text: the list becomes an auto-approve list for every user the artifact is
 * shared with, and a team- or global-scoped artifact naming `create_ado_work_item`
 * would silently pre-approve that for all of them.
 */
export const ARTIFACT_UTILITIES = ["export_table"] as const;
export type ArtifactUtility = (typeof ARTIFACT_UTILITIES)[number];
