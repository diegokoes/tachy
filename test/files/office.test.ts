import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  SHEET_MAX_ROWS,
  documentText,
  workbookText,
} from "../../packages/core/src/files/office";
import { renderXlsx } from "../../packages/core/src/exports/xlsx";
import type { TableColumn } from "../../packages/core/src/exports/table";
import { docx, zipOf } from "../fixtures/files";

const paragraph = (text: string, properties = "") =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("documentText", () => {
  it("writes a line per paragraph and a heading as a markdown heading", () => {
    // The style id is the template's own; the built-in name is what is fixed.
    const styles =
      '<w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Normal"/></w:style>';
    const body =
      paragraph(
        "Störung am Etikettendrucker",
        '<w:pStyle w:val="berschrift2"/>',
      ) +
      paragraph(
        "Druckt nicht &amp; meldet Fehler &#x41;7.",
        '<w:pStyle w:val="Standard"/>',
      ) +
      "<w:p></w:p>";
    expect(documentText(docx(body, styles))).toBe(
      "## Störung am Etikettendrucker\n\nDruckt nicht & meldet Fehler A7.",
    );
  });

  it("keeps tabs and line breaks, and not the tab stops a paragraph defines", () => {
    const body =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
      "<w:r><w:t>key</w:t><w:tab/><w:t>value</w:t><w:br/><w:t>next</w:t></w:r></w:p>";
    expect(documentText(docx(body))).toBe("key\tvalue\nnext");
  });

  it("writes a table row as tab-separated cells", () => {
    const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
    const body =
      paragraph("Before") +
      `<w:tbl><w:tr>${cell("Version")}${cell("Status")}</w:tr><w:tr>${cell("4.2")}${cell("fixed")}</w:tr></w:tbl>` +
      paragraph("After");
    expect(documentText(docx(body))).toBe(
      "Before\n\nVersion\tStatus\n\n4.2\tfixed\n\nAfter",
    );
  });

  it("leaves out deleted text and field codes", () => {
    const body =
      "<w:p><w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del>" +
      "<w:r><w:instrText>PAGE</w:instrText></w:r></w:p>";
    expect(documentText(docx(body))).toBe("kept");
  });

  it("refuses a zip that holds no document", () => {
    expect(() => documentText(zipOf({ "a.txt": "x" }))).toThrow(
      /not a Word document/,
    );
  });
});

const columns: TableColumn[] = [
  { key: "ticket_id", label: "Ticket", type: "string" },
  { key: "score", label: "Score", type: "number" },
  { key: "opened_at", label: "Opened", type: "date" },
  { key: "escalated", label: "Escalated", type: "boolean" },
];

const SHEET_NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook written by hand, to hold what tachy's own export never writes. */
function workbook(parts: {
  sheet: string;
  strings?: string;
  styles?: string;
  workbookProperties?: string;
  relationships?: boolean;
}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<workbook ${SHEET_NS}>${parts.workbookProperties ?? ""}<sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet ${SHEET_NS}><sheetData>${parts.sheet}</sheetData></worksheet>`,
    ),
  };
  if (parts.relationships !== false)
    files["xl/_rels/workbook.xml.rels"] = strToU8(
      '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    );
  if (parts.strings)
    files["xl/sharedStrings.xml"] = strToU8(`<sst>${parts.strings}</sst>`);
  if (parts.styles)
    files["xl/styles.xml"] = strToU8(
      `<styleSheet>${parts.styles}</styleSheet>`,
    );
  return zipSync(files);
}

const serialOf = (isoDay: string) => Date.parse(isoDay) / 86_400_000 + 25569;

describe("workbookText", () => {
  it("reads back what tachy's own export writes", () => {
    const bytes = renderXlsx("Tickets", columns, [
      ["FD-1", 3.5, new Date("2026-03-04T05:06:00Z"), true],
      ["FD-2", null, null, false],
    ]);
    expect(workbookText(bytes).split("\n")).toEqual([
      "## Sheet: Tickets",
      "Ticket\tScore\tOpened\tEscalated",
      "FD-1\t3.5\t2026-03-04 05:06\tTRUE",
      "FD-2\t\t\tFALSE",
    ]);
  });

  it("resolves shared strings, rich text included, without phonetic runs", () => {
    const bytes = workbook({
      strings:
        "<si><t>plain</t></si>" +
        "<si><r><t>rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si>",
      sheet:
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"/>' +
        '<row r="3"><c r="B3" t="str"><f>A1&amp;"!"</f><v>plain!</v></c></row>',
    });
    expect(workbookText(bytes).split("\n")).toEqual([
      "## Sheet: Data & more",
      "plain\t\trich text",
      "\tplain!",
    ]);
  });

  it("shows a date-formatted number as a date, in either date system", () => {
    const styles =
      '<numFmts><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.00 &quot;days&quot;"/></numFmts>' +
      '<cellStyleXfs><xf numFmtId="14"/></cellStyleXfs>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="165"/><xf numFmtId="166"/></cellXfs>';
    const day = serialOf("2026-03-04");
    const sheet =
      `<row r="1"><c r="A1"><v>${day}</v></c><c r="B1" s="1"><v>${day}</v></c>` +
      `<c r="C1" s="2" t="n"><v>${day}</v></c><c r="D1" s="3"><v>2.5</v></c></row>`;
    expect(workbookText(workbook({ styles, sheet })).split("\n")[1]).toBe(
      `${day}\t2026-03-04\t2026-03-04\t2.5`,
    );
    const from1904 = workbook({
      styles,
      workbookProperties: '<workbookPr date1904="1"/>',
      sheet: `<row r="1"><c r="A1" s="1"><v>${day - 1462}</v></c></row>`,
    });
    expect(workbookText(from1904).split("\n")[1]).toBe("2026-03-04");
  });

  it("finds the sheet by file order when the workbook has no relationships", () => {
    const bytes = workbook({
      relationships: false,
      sheet:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>only</t></is></c></row>',
    });
    expect(workbookText(bytes)).toBe("## Sheet: Data & more\nonly");
  });

  it("counts the rows past the limit instead of showing them", () => {
    const rows = Array.from({ length: SHEET_MAX_ROWS + 2 }, (_, i) => [
      `FD-${i}`,
      i,
      null,
      null,
    ]);
    const lines = workbookText(renderXlsx("Many", columns, rows)).split("\n");
    expect(lines).toHaveLength(SHEET_MAX_ROWS + 2);
    expect(lines.at(-1)).toBe("[3 more rows not shown]");
  });

  it("refuses a zip that holds no workbook", () => {
    expect(() => workbookText(zipOf({ "a.txt": "x" }))).toThrow(
      /not an Excel workbook/,
    );
  });
});
