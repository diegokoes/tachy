/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { toEntry } from "../../packages/web/src/library/items";
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
