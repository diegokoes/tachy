import { describe, expect, it } from "vitest";
import type { ConsoleSection } from "../../packages/web/src/admin/pages";
import {
  OVERVIEW_ROW,
  sectionMenu,
} from "../../packages/web/src/admin/sectionMenu";

const sections: ConsoleSection[] = [
  { key: "sources", label: "sources", n: "sources" },
  { key: "repos", label: "repos", n: "repos" },
  { key: "bulk-link", label: "bulk link" },
];

describe("the console corner menu", () => {
  it("lists the page's sections with their counts on the overview", () => {
    expect(sectionMenu(sections, { sources: 3, repos: 12_400 })).toEqual([
      { key: "sources", label: "sources", hint: "3", current: false },
      { key: "repos", label: "repos", hint: "12.4K", current: false },
      { key: "bulk-link", label: "bulk link", hint: undefined, current: false },
    ]);
  });

  it("leaves the counts out while the census loads", () => {
    expect(
      sectionMenu(sections, null).every((row) => row.hint === undefined),
    ).toBe(true);
  });

  it("puts the way back to the overview first, and marks the open section", () => {
    const rows = sectionMenu(sections, { sources: 3, repos: 8 }, "repos");
    expect(rows[0]).toEqual({ key: OVERVIEW_ROW, label: "‹ overview" });
    expect(rows.filter((row) => row.current).map((row) => row.key)).toEqual([
      "repos",
    ]);
  });
});
