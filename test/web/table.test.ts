import { describe, expect, it } from "vitest";
import { EMPTY } from "../../packages/web/src/tui/glyphs";
import { cellText, type Column } from "../../packages/web/src/tui/table";

type Row = { name?: string | null; runs?: number };
const column = (key: string): Column<Row> => ({ key, label: key });

describe("table cells", () => {
  it("prints the one empty mark for a missing or blank value", () => {
    expect(cellText(column("name"), {})).toBe(EMPTY);
    expect(cellText(column("name"), { name: null })).toBe(EMPTY);
    expect(cellText(column("name"), { name: "" })).toBe(EMPTY);
  });

  it("prints a zero and any other value as it is", () => {
    expect(cellText(column("runs"), { runs: 0 })).toBe("0");
    expect(cellText(column("name"), { name: "acme" })).toBe("acme");
  });
});
