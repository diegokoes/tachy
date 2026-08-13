import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  colRef,
  renderXlsx,
  sheetName,
} from "../packages/core/src/exports/xlsx";
import type { TableColumn } from "../packages/core/src/exports/table";

const columns: TableColumn[] = [
  { key: "ticket_id", label: "Ticket", type: "string" },
  { key: "score", label: "Score", type: "number" },
  { key: "opened_at", label: "Opened", type: "date" },
  { key: "escalated", label: "Escalated", type: "boolean" },
];

const book = (rows: Parameters<typeof renderXlsx>[2], name = "Tickets") =>
  unzipSync(renderXlsx(name, columns, rows));

const sheet = (rows: Parameters<typeof renderXlsx>[2], name?: string) =>
  strFromU8(book(rows, name)["xl/worksheets/sheet1.xml"]);

describe("xlsx package layout", () => {
  it("writes the parts Excel requires", () => {
    expect(Object.keys(book([["FD-1", 1, null, null]]))).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("carries the sheet name into the workbook part", () => {
    expect(
      strFromU8(book([["FD-1", 1, null, null]])["xl/workbook.xml"]),
    ).toContain('name="Tickets"');
  });
});

describe("cell typing", () => {
  it("writes a bold header row from the column labels", () => {
    const xml = sheet([["FD-1", 1, null, null]]);
    expect(xml).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t>Ticket</t></is></c>',
    );
    expect(xml).toContain("<t>Escalated</t>");
  });

  it("types numbers, booleans and dates rather than stringifying them", () => {
    const xml = sheet([["FD-1", 12.5, new Date("2026-08-01T09:30:00Z"), true]]);
    expect(xml).toContain('<c r="B2"><v>12.5</v></c>');
    expect(xml).toContain('<c r="C2" s="2"><v>46235.39583333333</v></c>');
    expect(xml).toContain('<c r="D2" t="b"><v>1</v></c>');
  });

  it("leaves a null as an empty cell, never the text null", () => {
    const xml = sheet([["FD-1", null, null, null]]);
    expect(xml).toContain('<c r="B2"/>');
    expect(xml).not.toContain("null");
  });

  it("escapes XML metacharacters", () => {
    expect(sheet([[`Acme <&> "Co"`, null, null, null]])).toContain(
      "Acme &lt;&amp;&gt; &quot;Co&quot;",
    );
  });

  it("strips the control characters Excel rejects", () => {
    const bell = String.fromCharCode(7);
    const xml = sheet([[`ring${bell}ing`, null, null, null]]);
    expect(xml).toContain("<t>ringing</t>");
    expect(xml).not.toContain(bell);
  });

  it("preserves leading and trailing whitespace explicitly", () => {
    expect(sheet([["  padded  ", null, null, null]])).toContain(
      '<t xml:space="preserve">  padded  </t>',
    );
  });
});

describe("sheet chrome", () => {
  it("freezes the header and sets an autofilter over the used range", () => {
    const xml = sheet([
      ["FD-1", 1, null, null],
      ["FD-2", 2, null, null],
    ]);
    expect(xml).toContain('<dimension ref="A1:D3"/>');
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('<autoFilter ref="A1:D3"/>');
  });

  it("survives a header-only export", () => {
    expect(sheet([])).toContain('<dimension ref="A1:D1"/>');
  });
});

describe("colRef", () => {
  it("carries past Z the way Excel does", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(colRef)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
});

describe("sheetName", () => {
  it("drops the characters Excel forbids and caps at 31 chars", () => {
    expect(sheetName("Q3/Q4: [tickets]*?")).toBe("Q3 Q4   tickets");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(sheetName(undefined)).toBe("Sheet1");
    expect(sheetName("///")).toBe("Sheet1");
  });
});
