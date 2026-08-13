import { describe, expect, it } from "vitest";
import {
  coerceRows,
  outputFilename,
  renderColumnContract,
  renderCsv,
  renderTable,
  tableOutputSchema,
  validateRows,
  type TableColumn,
} from "../packages/core/src/exports/table";

const columns = (over: Partial<TableColumn>[] = []): TableColumn[] =>
  [
    { key: "ticket_id", label: "Ticket", type: "string", required: true },
    { key: "customer", label: "Customer", type: "string" },
    { key: "score", label: "Score", type: "number" },
    { key: "opened_at", label: "Opened", type: "date" },
    { key: "escalated", label: "Escalated", type: "boolean" },
  ].map((c, i) => ({ ...c, ...(over[i] ?? {}) })) as TableColumn[];

const decode = (b: Uint8Array) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);

describe("column contract validation", () => {
  it("accepts rows that match the declared columns", () => {
    expect(
      validateRows(columns(), [
        {
          ticket_id: "FD-1",
          customer: "Acme",
          score: 3,
          opened_at: "2026-08-01T09:30:00Z",
          escalated: true,
        },
      ]),
    ).toEqual([]);
  });

  it("names an unknown column and lists the allowed keys", () => {
    const problems = validateRows(columns(), [
      { ticket_id: "FD-1", severity: "high" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('unknown column "severity"');
    expect(problems[0]).toContain("allowed: ticket_id, customer");
  });

  it("reports a missing required value by row and column", () => {
    const problems = validateRows(columns(), [{ customer: "Acme" }]);
    expect(problems).toEqual([
      'row 1: column "ticket_id" is required but empty',
    ]);
  });

  it("reports values that cannot become the declared type", () => {
    const problems = validateRows(columns(), [
      { ticket_id: "FD-1", score: "not-a-number", opened_at: "whenever" },
    ]);
    expect(problems).toEqual([
      'row 1: column "score" expects a number, got "not-a-number"',
      'row 1: column "opened_at" expects a date, got "whenever"',
    ]);
  });

  it("rejects an empty row set and caps a runaway problem list", () => {
    expect(validateRows(columns(), [])).toContain(
      "rows is empty — nothing to export",
    );
    const many = Array.from({ length: 40 }, () => ({ nope: 1 }));
    const problems = validateRows(columns(), many);
    expect(problems).toHaveLength(21);
    expect(problems.at(-1)).toMatch(/and \d+ more/);
  });

  it("leaves an optional column empty rather than inventing a value", () => {
    expect(
      coerceRows(columns(), [{ ticket_id: "FD-1", customer: null }]),
    ).toEqual([["FD-1", null, null, null, null]]);
  });
});

describe("type coercion", () => {
  it("takes numbers, booleans and dates in the shapes a model emits", () => {
    const [row] = coerceRows(columns(), [
      {
        ticket_id: 42,
        customer: { name: "Acme" },
        score: "12.5",
        opened_at: 1754000000000,
        escalated: "no",
      },
    ]);
    expect(row[0]).toBe("42");
    expect(row[1]).toBe('{"name":"Acme"}');
    expect(row[2]).toBe(12.5);
    expect(row[3]).toBeInstanceOf(Date);
    expect((row[3] as Date).getTime()).toBe(1754000000000);
    expect(row[4]).toBe(false);
  });
});

describe("CSV rendering", () => {
  it("quotes commas, quotes and newlines, and leads with a BOM", () => {
    const cols: TableColumn[] = [
      { key: "a", type: "string" },
      { key: "b", type: "string" },
    ];
    const bytes = renderCsv(cols, [
      ['say "hi"', "one,two"],
      ["line\nbreak", null],
    ]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const lines = decode(bytes).slice(1).split("\r\n");
    expect(lines[0]).toBe("a,b");
    expect(lines[1]).toBe('"say ""hi""","one,two"');
    expect(lines[2]).toBe('"line\nbreak",');
  });

  it("writes dates as ISO so a spreadsheet can parse them", () => {
    const cols: TableColumn[] = [{ key: "at", type: "date" }];
    const text = decode(renderCsv(cols, [[new Date("2026-08-01T09:30:00Z")]]));
    expect(text).toContain("2026-08-01T09:30:00.000Z");
  });
});

describe("renderTable", () => {
  it("throws the problems instead of shipping a wrong sheet", () => {
    expect(() =>
      renderTable({
        format: "csv",
        columns: columns(),
        rows: [{ ticket_id: "FD-1", bogus: 1 }],
      }),
    ).toThrow(/unknown column "bogus"/);
  });

  it("returns the format's mime type", () => {
    const csv = renderTable({
      format: "csv",
      columns: columns(),
      rows: [{ ticket_id: "FD-1" }],
    });
    expect(csv.mime).toMatch(/text\/csv/);
    const xlsx = renderTable({
      format: "xlsx",
      columns: columns(),
      rows: [{ ticket_id: "FD-1" }],
    });
    expect(xlsx.mime).toMatch(/spreadsheetml/);
  });
});

describe("outputFilename", () => {
  it("expands {date} and {slug} and appends the extension", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      outputFilename({ filename: "{slug}-{date}", format: "xlsx" }, "register"),
    ).toBe(`register-${today}.xlsx`);
    expect(outputFilename({ format: "csv" }, "export")).toBe(
      `export-${today}.csv`,
    );
  });

  it("does not double the extension", () => {
    expect(outputFilename({ filename: "rows.csv", format: "csv" }, "x")).toBe(
      "rows.csv",
    );
  });
});

describe("renderColumnContract", () => {
  it("names the artifact, format, types and required flags", () => {
    const spec = tableOutputSchema.parse({
      format: "xlsx",
      columns: [
        { key: "ticket_id", required: true, description: "source ticket id" },
        { key: "opened_at", type: "date" },
      ],
    });
    const contract = renderColumnContract("escalation-register", spec);
    expect(contract).toContain('artifact="escalation-register"');
    expect(contract).toContain('format="xlsx"');
    expect(contract).toContain(
      "ticket_id (string, required) — source ticket id",
    );
    expect(contract).toContain("opened_at (date)");
    expect(contract).toContain(
      'export_table with artifact_slug "escalation-register"',
    );
    expect(contract).toContain("</output-contract>");
  });
});
