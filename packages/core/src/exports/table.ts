import { z } from "zod";
import {
  TABLE_CELL_TYPES,
  TABLE_FORMATS,
  outputFilename,
  columnHeading,
} from "@tachy/contract";
import type {
  TableCellType,
  TableFormat,
  TableColumn,
  TableOutput,
} from "@tachy/contract";
import { badInput } from "../infra/errors";
import { renderXlsx } from "./xlsx";

export { TABLE_CELL_TYPES, TABLE_FORMATS, outputFilename };
export type { TableCellType, TableFormat, TableColumn, TableOutput };

export const tableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(TABLE_CELL_TYPES).default("string"),
  required: z.boolean().optional(),
  description: z.string().optional(),
});

export const tableOutputSchema = z.object({
  format: z.enum(TABLE_FORMATS).default("xlsx"),
  sheet: z.string().optional(),
  filename: z.string().optional(),
  columns: z.array(tableColumnSchema).min(1),
});

/**
 * The schemas above are only the parser; @tachy/contract owns the shape, so the
 * editor in the SPA and the renderer here cannot disagree about it. This stops
 * compiling if the two drift apart.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _shapesMatch: [
  Same<z.infer<typeof tableColumnSchema>, TableColumn>,
  Same<z.infer<typeof tableOutputSchema>, TableOutput>,
] = [true, true];
void _shapesMatch;

export type CellValue = string | number | boolean | Date | null;
export type TableRow = Record<string, unknown>;

export const MAX_TABLE_ROWS = 50_000;
export const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const MAX_REPORTED_PROBLEMS = 20;

export const MIME_BY_FORMAT: Record<TableFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

type Converted = { value: CellValue } | { problem: string };

function convert(column: TableColumn, raw: unknown): Converted {
  if (raw === null || raw === undefined || raw === "")
    return column.required
      ? { problem: `column "${column.key}" is required but empty` }
      : { value: null };

  switch (column.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(n)
        ? { value: n }
        : {
            problem: `column "${column.key}" expects a number, got ${JSON.stringify(raw)}`,
          };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (s === "true" || s === "yes" || s === "1") return { value: true };
      if (s === "false" || s === "no" || s === "0") return { value: false };
      return {
        problem: `column "${column.key}" expects a boolean, got ${JSON.stringify(raw)}`,
      };
    }
    case "date": {
      const d =
        raw instanceof Date
          ? raw
          : typeof raw === "number"
            ? new Date(raw)
            : new Date(String(raw));
      return Number.isNaN(d.getTime())
        ? {
            problem: `column "${column.key}" expects a date, got ${JSON.stringify(raw)}`,
          }
        : { value: d };
    }
    default:
      return {
        value: typeof raw === "object" ? JSON.stringify(raw) : String(raw),
      };
  }
}

/**
 * Every way the model's rows fail the declared columns, phrased so it can fix
 * them and retry rather than shipping a wrong sheet.
 */
export function validateRows(
  columns: TableColumn[],
  rows: TableRow[],
): string[] {
  const problems: string[] = [];
  if (!rows.length) problems.push("rows is empty — nothing to export");
  if (rows.length > MAX_TABLE_ROWS)
    problems.push(`too many rows: ${rows.length} (max ${MAX_TABLE_ROWS})`);

  const known = new Set(columns.map((c) => c.key));
  const allowed = columns.map((c) => c.key).join(", ");

  rows.slice(0, MAX_TABLE_ROWS).forEach((row, i) => {
    for (const key of Object.keys(row))
      if (!known.has(key))
        problems.push(
          `row ${i + 1}: unknown column "${key}" (allowed: ${allowed})`,
        );
    for (const column of columns) {
      const got = convert(column, row[column.key]);
      if ("problem" in got) problems.push(`row ${i + 1}: ${got.problem}`);
    }
  });

  if (problems.length <= MAX_REPORTED_PROBLEMS) return problems;
  return [
    ...problems.slice(0, MAX_REPORTED_PROBLEMS),
    `…and ${problems.length - MAX_REPORTED_PROBLEMS} more`,
  ];
}

export function coerceRows(
  columns: TableColumn[],
  rows: TableRow[],
): CellValue[][] {
  return rows.map((row) =>
    columns.map((column) => {
      const got = convert(column, row[column.key]);
      return "problem" in got ? null : got.value;
    }),
  );
}

const CSV_BOM = "\uFEFF";

/**
 * Cell text is composed by the model out of ticket content, so a cell can begin
 * with a character Excel and Sheets read as the start of a formula — a pasted
 * `=HYPERLINK("http://…"&A1)` becomes live in the download. A leading apostrophe
 * is the spreadsheet convention for "this is text": it is consumed on the way
 * in and does not show in the cell.
 *
 * The xlsx path needs none of this, because an inline string is already
 * unambiguously a string there.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value: CellValue): string {
  if (value === null) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  // Only strings: a number is already unambiguous, and prefixing -5 would file
  // it in the spreadsheet as text.
  const text =
    typeof value === "string" && FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv(
  columns: TableColumn[],
  rows: CellValue[][],
): Uint8Array {
  const head = columns.map((c) => csvCell(columnHeading(c))).join(",");
  const body = rows.map((row) => row.map(csvCell).join(","));
  return new TextEncoder().encode(
    `${CSV_BOM}${[head, ...body].join("\r\n")}\r\n`,
  );
}

export interface RenderedTable {
  bytes: Uint8Array;
  mime: string;
  format: TableFormat;
}

export function renderTable(i: {
  format: TableFormat;
  sheet?: string;
  columns: TableColumn[];
  rows: TableRow[];
}): RenderedTable {
  const problems = validateRows(i.columns, i.rows);
  if (problems.length) throw badInput(problems.join("\n"));

  const cells = coerceRows(i.columns, i.rows);
  const bytes =
    i.format === "csv"
      ? renderCsv(i.columns, cells)
      : renderXlsx(i.sheet, i.columns, cells);

  if (bytes.byteLength > MAX_OUTPUT_BYTES)
    throw badInput(
      `generated file is ${bytes.byteLength} bytes, over the ${MAX_OUTPUT_BYTES} limit — export fewer rows`,
    );
  return { bytes, mime: MIME_BY_FORMAT[i.format], format: i.format };
}

/** The column contract injected into a turn when the attached artifact declares one. */
export function renderColumnContract(
  slug: string,
  output: TableOutput,
): string {
  const columns = output.columns.map((c) => {
    const flags = c.required ? `${c.type}, required` : c.type;
    return `  ${c.key} (${flags})${c.description ? ` — ${c.description}` : ""}`;
  });
  return [
    `<output-contract utility="export_table" artifact="${slug}" format="${output.format}">`,
    "Produce one row per record with EXACTLY these columns — no extras, no renames:",
    ...columns,
    `Then call export_table with artifact_slug "${slug}" and those rows.`,
    "Do not print the table in chat — the user gets a download.",
    "</output-contract>",
  ].join("\n");
}
