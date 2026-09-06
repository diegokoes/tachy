import { describe, expect, it } from "vitest";
import * as contract from "@tachy/contract";
import * as core from "@tachy/core";

/**
 * CLAUDE.md: a rule both sides enforce belongs in the contract, and core
 * re-exports it so server code still reaches it through @tachy/core. The
 * failure this guards is quiet — packages/api imports only from core, so a
 * symbol missing from that re-export is not an error there, it is a literal
 * written out by hand. That is how the admin panel and the vault came to
 * disagree about what a valid Anthropic key looks like, and how
 * routes/setup.ts came to carry its own copy of "sk-ant-oat01-".
 */
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
