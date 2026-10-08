import { describe, expect, it } from "vitest";
import * as contract from "@tachy/contract";
import * as core from "@tachy/core";

// CLAUDE.md: a rule both sides enforce belongs in the contract, and core
// re-exports it. packages/api imports only from core, so a symbol missing from
// that re-export is no error there: it gets written out by hand as a literal.
describe("every contract export reaches @tachy/core", () => {
  it("re-exports the whole contract surface", () => {
    const missing = Object.keys(contract).filter((name) => !(name in core));
    expect(missing).toEqual([]);
  });

  it("re-exports the same value, not a copy", () => {
    for (const [name, value] of Object.entries(contract)) {
      if (typeof value !== "object" && typeof value !== "function") continue;
      expect((core as Record<string, unknown>)[name], name).toBe(value);
    }
  });
});
