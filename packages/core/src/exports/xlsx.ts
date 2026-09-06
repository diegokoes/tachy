import { strToU8, zipSync } from "fflate";
import { columnHeading, sheetName } from "@tachy/contract";
import type { CellValue, TableColumn } from "./table";

export { sheetName };

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_OFFSET = 25569;

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATE = 2;

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";

function esc(value: string): string {
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function colRef(index: number): string {
  let n = index + 1;
  let ref = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    ref = String.fromCharCode(65 + rem) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
}

const dateSerial = (d: Date) => d.getTime() / MS_PER_DAY + EXCEL_EPOCH_OFFSET;

function cell(ref: string, value: CellValue, style: number): string {
  if (value instanceof Date)
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${dateSerial(value)}</v></c>`;
  const s = style === STYLE_DEFAULT ? "" : ` s="${style}"`;
  if (value === null) return `<c r="${ref}"${s}/>`;
  if (typeof value === "number")
    return Number.isFinite(value)
      ? `<c r="${ref}"${s}><v>${value}</v></c>`
      : `<c r="${ref}"${s}/>`;
  if (typeof value === "boolean")
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const preserve = value !== value.trim() ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t${preserve}>${esc(value)}</t></is></c>`;
}

function cellWidth(value: CellValue): number {
  if (value === null) return 0;
  if (value instanceof Date) return 16;
  return String(value).length;
}

function cols(columns: TableColumn[], rows: CellValue[][]): string {
  const entries = columns.map((column, i) => {
    let max = columnHeading(column).length;
    for (const row of rows) max = Math.max(max, cellWidth(row[i]));
    const width = Math.min(60, Math.max(8, max + 2));
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  });
  return `<cols>${entries.join("")}</cols>`;
}

const CONTENT_TYPES = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function renderXlsx(
  name: string | undefined,
  columns: TableColumn[],
  rows: CellValue[][],
): Uint8Array {
  const dimension = `A1:${colRef(columns.length - 1)}${rows.length + 1}`;

  const header = columns
    .map((c, i) => cell(`${colRef(i)}1`, columnHeading(c), STYLE_HEADER))
    .join("");
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 2}">${row
          .map((v, i) => cell(`${colRef(i)}${r + 2}`, v, STYLE_DEFAULT))
          .join("")}</row>`,
    )
    .join("");

  const worksheet = `${XML_HEADER}<worksheet xmlns="${MAIN_NS}"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols(columns, rows)}<sheetData><row r="1">${header}</row>${body}</sheetData><autoFilter ref="${dimension}"/></worksheet>`;

  const workbook = `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${esc(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(STYLES),
      "xl/worksheets/sheet1.xml": strToU8(worksheet),
    },
    { level: 6 },
  );
}
