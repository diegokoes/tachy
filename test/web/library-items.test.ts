/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { toEntry, type Item } from "../../packages/web/src/library/items";
import type { KnowledgeRow } from "../../packages/web/src/knowledge/rows";

const entry = (versions: Partial<KnowledgeRow>) =>
  toEntry({ id: "e1", status: "approved", ...versions } as KnowledgeRow, "");

describe("library entry versions", () => {
  it("names each version it shows", () => {
    expect(
      entry({ affected_version: "7.0", fixed_version: "9.5" }).version,
    ).toBe("affected 7.0 · fixed 9.5");
    expect(entry({ affected_version: "7.0" }).version).toBe("affected 7.0");
    expect(entry({ fixed_version: "9.5" }).version).toBe("fixed 9.5");
    expect(entry({}).version).toBeUndefined();
  });
});

describe("library entry rows", () => {
  const row = {
    id: "e1",
    status: "approved",
    title: "Spooler stalls on long batches",
    issue_summary: "The spooler halts once a batch passes 500 labels.",
    root_cause: "The buffer overruns at error 023.",
    resolution: "Restart the spooler service.",
    signals: ["023"],
  } as KnowledgeRow;
  const snippet = (item: Item) =>
    item.snippet?.map((piece) => piece.t).join("");

  it("is headed by the title, not the summary", () => {
    expect(toEntry(row, "").title).toBe("Spooler stalls on long batches");
  });

  it("shows the summary under the title while browsing", () => {
    expect(snippet(toEntry(row, ""))).toBe(
      "The spooler halts once a batch passes 500 labels.",
    );
  });

  it("shows the field a search hit", () => {
    expect(snippet(toEntry(row, "restart service"))).toContain(
      "Restart the spooler service.",
    );
  });
});
