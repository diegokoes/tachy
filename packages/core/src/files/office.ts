import { badInput } from "../infra/errors";
import { attribute, xmlTokens } from "./xml";
import { readZipEntry, zipEntries, type ZipEntry } from "./zip";

/** One part of a document, unpacked. Its text is held whole while it is read. */
const PART_MAX_BYTES = 32 * 1024 * 1024;

export const DOCUMENT_PART = "word/document.xml";
export const WORKBOOK_PART = "xl/workbook.xml";

/** A reader of an office file's parts by name; undefined for a part it lacks. */
function partReader(bytes: Uint8Array): (name: string) => string | undefined {
  const entries = new Map<string, ZipEntry>(
    zipEntries(bytes).map((entry) => [entry.name, entry]),
  );
  return (name) => {
    const entry = entries.get(name);
    if (!entry) return undefined;
    return new TextDecoder().decode(readZipEntry(bytes, entry, PART_MAX_BYTES));
  };
}

/**
 * Style ids by heading level. The id is whatever the template's language made
 * it, while a built-in heading's name is always "heading N".
 */
function headingStyles(stylesXml: string | undefined): Map<string, number> {
  const levels = new Map<string, number>();
  if (!stylesXml) return levels;
  let styleId: string | undefined;
  for (const token of xmlTokens(stylesXml)) {
    if (token.kind === "text" || token.kind === "close") continue;
    if (token.name === "w:style")
      styleId = attribute(token.attributes, "w:styleId");
    if (token.name !== "w:name" || !styleId) continue;
    const level = /^heading (\d)$/i.exec(
      attribute(token.attributes, "w:val") ?? "",
    )?.[1];
    if (level) levels.set(styleId, Number(level));
  }
  return levels;
}

/**
 * A Word document as text: a line per paragraph, a heading as a markdown
 * heading, a table row as tab-separated cells. Headers, footers, notes and
 * tracked deletions are left out.
 */
export function documentText(bytes: Uint8Array): string {
  const part = partReader(bytes);
  const body = part(DOCUMENT_PART);
  if (body === undefined) throw badInput("the file is not a Word document");
  const headings = headingStyles(part("word/styles.xml"));

  const lines: string[] = [];
  let paragraph = "";
  let headingLevel = 0;
  let inText = false;
  let tableDepth = 0;
  let cells: string[] = [];
  let cell: string[] = [];

  const endParagraph = () => {
    const text = paragraph.trim();
    paragraph = "";
    const level = headingLevel;
    headingLevel = 0;
    if (tableDepth > 0) {
      if (text) cell.push(text);
      return;
    }
    if (!text) return;
    lines.push(level ? `${"#".repeat(level)} ${text}` : text);
  };

  for (const token of xmlTokens(body)) {
    if (token.kind === "text") {
      if (inText) paragraph += token.text;
      continue;
    }
    const { kind, name } = token;
    if (name === "w:t") inText = kind === "open";
    // With attributes it is a tab stop in the paragraph's settings, not a tab.
    else if (name === "w:tab" && !token.attributes.trim()) paragraph += "\t";
    else if ((name === "w:br" || name === "w:cr") && kind !== "close")
      paragraph += "\n";
    else if (name === "w:pStyle" && kind !== "close")
      headingLevel =
        headings.get(attribute(token.attributes, "w:val") ?? "") ?? 0;
    else if (name === "w:p" && kind === "close") endParagraph();
    else if (name === "w:tbl") tableDepth += tableStep(kind);
    else if (name === "w:tc" && kind === "close") {
      cells.push(cell.join(" "));
      cell = [];
    } else if (name === "w:tr" && kind === "close") {
      lines.push(cells.join("\t"));
      cells = [];
    }
  }
  return lines.join("\n\n");
}

const tableStep = (kind: "open" | "close" | "empty") =>
  ({ open: 1, close: -1, empty: 0 })[kind];

/** Rows of a sheet past this are counted, not shown. */
export const SHEET_MAX_ROWS = 5000;

/** Number formats that Excel defines as dates or times, by their fixed id. */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** A custom format is a date when it has a date or time letter outside quotes. */
const isDateFormat = (code: string) =>
  /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));

/** For each cell style index, whether it shows its number as a date. */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const customDates = new Set<number>();
  const styles: boolean[] = [];
  let inCellFormats = false;
  for (const token of xmlTokens(stylesXml)) {
    if (token.kind === "text") continue;
    if (token.name === "cellXfs") inCellFormats = token.kind === "open";
    if (token.kind === "close") continue;
    const formatId = Number(attribute(token.attributes, "numFmtId"));
    if (token.name === "numFmt") {
      const code = attribute(token.attributes, "formatCode") ?? "";
      if (isDateFormat(code)) customDates.add(formatId);
    } else if (token.name === "xf" && inCellFormats)
      styles.push(
        BUILTIN_DATE_FORMATS.has(formatId) || customDates.has(formatId),
      );
  }
  return styles;
}

const DAY_MS = 86_400_000;
/** Day 25569 of the 1900 date system is 1970-01-01. */
const EPOCH_SERIAL = 25569;
/** The 1904 date system counts from 1462 days later. */
const DATE_1904_OFFSET_DAYS = 1462;

/** A date serial as ISO, to the day when it holds no time. */
function serialDate(serial: number, date1904: boolean): string {
  const days = serial + (date1904 ? DATE_1904_OFFSET_DAYS : 0);
  const iso = new Date(
    Math.round((days - EPOCH_SERIAL) * DAY_MS),
  ).toISOString();
  return Number.isInteger(serial)
    ? iso.slice(0, 10)
    : iso.slice(0, 16).replace("T", " ");
}

function sharedStrings(xml: string | undefined): string[] {
  const strings: string[] = [];
  if (!xml) return strings;
  let current = "";
  let inText = false;
  let inPhonetic = false;
  for (const token of xmlTokens(xml)) {
    if (token.kind === "text") {
      if (inText && !inPhonetic) current += token.text;
      continue;
    }
    if (token.name === "t") inText = token.kind === "open";
    else if (token.name === "rPh") inPhonetic = token.kind === "open";
    else if (token.name === "si" && token.kind !== "open") {
      strings.push(current);
      current = "";
    }
  }
  return strings;
}

/** "C7" names column 2: letters are base 26 with no zero. */
function columnIndex(cellRef: string | undefined, fallback: number): number {
  const letters = /^[A-Z]+/i.exec(cellRef ?? "")?.[0];
  if (!letters) return fallback;
  let index = 0;
  for (const letter of letters.toUpperCase())
    index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

interface SheetContext {
  strings: string[];
  dateStyles: boolean[];
  date1904: boolean;
}

function cellValue(
  raw: string,
  type: string | undefined,
  styleIndex: number,
  context: SheetContext,
): string {
  if (type === "s") return context.strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  const isNumber = !type || type === "n";
  if (!isNumber || raw === "" || !context.dateStyles[styleIndex]) return raw;
  const serial = Number(raw);
  return Number.isFinite(serial) ? serialDate(serial, context.date1904) : raw;
}

/** A cell as one field of a tab-separated row. */
const field = (value: string) => value.replace(/[\t\r\n]+/g, " ").trim();

function sheetRows(xml: string, context: SheetContext): string[] {
  const rows: string[] = [];
  let hidden = 0;
  let cells: string[] = [];
  let column = 0;
  let type: string | undefined;
  let styleIndex = 0;
  let value = "";
  let inValue = false;

  for (const token of xmlTokens(xml)) {
    if (token.kind === "text") {
      if (inValue) value += token.text;
      continue;
    }
    const { kind, name } = token;
    if (name === "c" && kind !== "close") {
      column = columnIndex(attribute(token.attributes, "r"), cells.length);
      type = attribute(token.attributes, "t");
      styleIndex = Number(attribute(token.attributes, "s") ?? 0);
      value = "";
    }
    // `v` holds a stored value, `t` the text of an inline string.
    if (name === "v" || name === "t") inValue = kind === "open";
    if (name === "c" && kind !== "open") {
      while (cells.length < column) cells.push("");
      cells[column] = field(cellValue(value, type, styleIndex, context));
    }
    if (name !== "row" || kind === "open") continue;
    const line = cells.join("\t").replace(/\t+$/, "");
    cells = [];
    if (!line) continue;
    if (rows.length < SHEET_MAX_ROWS) rows.push(line);
    else hidden++;
  }
  if (hidden) rows.push(`[${hidden} more rows not shown]`);
  return rows;
}

/** Where a workbook relationship points, as a part name. */
function relationshipTargets(relsXml: string | undefined): Map<string, string> {
  const targets = new Map<string, string>();
  if (!relsXml) return targets;
  for (const token of xmlTokens(relsXml)) {
    if (token.kind === "text" || token.name !== "Relationship") continue;
    const id = attribute(token.attributes, "Id");
    const target = attribute(token.attributes, "Target");
    if (!id || !target) continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  return targets;
}

/**
 * An Excel workbook as text: each sheet under its name, a row per line with
 * tab-separated cells. Values as stored: a formula shows its last result, a
 * date-formatted number shows as an ISO date.
 */
export function workbookText(bytes: Uint8Array): string {
  const part = partReader(bytes);
  const workbook = part(WORKBOOK_PART);
  if (workbook === undefined)
    throw badInput("the file is not an Excel workbook");
  const targets = relationshipTargets(part("xl/_rels/workbook.xml.rels"));

  const sheets: { name: string; part: string }[] = [];
  let date1904 = false;
  for (const token of xmlTokens(workbook)) {
    if (token.kind === "text" || token.kind === "close") continue;
    if (token.name === "workbookPr")
      date1904 = /^(1|true)$/.test(
        attribute(token.attributes, "date1904") ?? "",
      );
    if (token.name !== "sheet") continue;
    // Without its relationships part, a workbook's sheets are in file order.
    const target =
      targets.get(attribute(token.attributes, "r:id") ?? "") ??
      `xl/worksheets/sheet${sheets.length + 1}.xml`;
    sheets.push({
      name: attribute(token.attributes, "name") ?? target,
      part: target,
    });
  }

  const context: SheetContext = {
    strings: sharedStrings(part("xl/sharedStrings.xml")),
    dateStyles: dateStyles(part("xl/styles.xml")),
    date1904,
  };
  return sheets
    .map((sheet) => {
      const xml = part(sheet.part);
      const rows = xml ? sheetRows(xml, context) : [];
      return [`## Sheet: ${sheet.name}`, ...rows].join("\n");
    })
    .join("\n\n");
}
