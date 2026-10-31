import { describe, expect, it } from "vitest";
import { EMPTY } from "../../packages/web/src/tui/glyphs";
import {
  cellText,
  draftChanged,
  type Column,
} from "../../packages/web/src/tui/table";

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

describe("draft changes", () => {
  it("sees an edit, and not a look", () => {
    const opened = { name: "acme", notes: "", active: true };
    expect(draftChanged(opened, { ...opened })).toBe(false);
    expect(draftChanged(opened, { ...opened, name: "acme co" })).toBe(true);
    expect(draftChanged(opened, { ...opened, active: false })).toBe(true);
  });

  it("takes an emptied field and a missing one for the same", () => {
    expect(draftChanged({ notes: "" }, { notes: null })).toBe(false);
    expect(draftChanged({ notes: "" }, {})).toBe(false);
    expect(draftChanged({}, { notes: "kept" })).toBe(true);
  });
});
