/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "../../packages/web/src/lib/slug";
import { ANSI16 } from "../../packages/web/src/lib/accent-palette";
import {
  CONFIDENCES,
  KNOWLEDGE_STATUSES,
  RESOLUTION_CLARITIES,
} from "../../packages/web/src/lib/vocab";
import * as contract from "@tachy/contract";

describe("slugify", () => {
  it.each([
    ["Label Renderer", "label-renderer"],
    ["  Spooler  ", "spooler"],
    ["A/B testing", "a-b-testing"],
    ["---", ""],
    ["", ""],
  ])("turns %o into %o", (input, want) => {
    expect(slugify(input)).toBe(want);
  });

  /**
   * Accented characters are dropped, not transliterated, so a name that is
   * mostly non-ascii slugs to very little — worth knowing before naming a
   * product in one. `uniqueSlug` is what keeps two such names from colliding.
   */
  it("drops non-ascii rather than transliterating it", () => {
    expect(slugify("Ünïcode name")).toBe("n-code-name");
    expect(slugify("Ünïcode")).toBe("n-code");
  });

  it("never leaves a leading or trailing hyphen", () => {
    for (const s of ["!hi!", "  --x--  ", "###"]) {
      const out = slugify(s);
      expect(out).not.toMatch(/^-|-$/);
    }
  });
});

/**
 * Every create route upserts on its slug, so a collision silently overwrites
 * the record it collided with. Suffixing is what stops that being possible.
 */
describe("uniqueSlug", () => {
  it("keeps a free slug as it is", () => {
    expect(uniqueSlug("spooler", ["queue"])).toBe("spooler");
  });

  it("suffixes from 2 upwards past every taken form", () => {
    expect(uniqueSlug("spooler", ["spooler"])).toBe("spooler-2");
    expect(uniqueSlug("spooler", ["spooler", "spooler-2"])).toBe("spooler-3");
  });

  it("skips a gap rather than reusing a taken suffix", () => {
    expect(uniqueSlug("spooler", ["spooler", "spooler-3"])).toBe("spooler-2");
  });

  it("passes an empty base straight through", () => {
    expect(uniqueSlug("", ["a"])).toBe("");
  });

  it("accepts any iterable of taken slugs", () => {
    expect(uniqueSlug("spooler", new Set(["spooler"]))).toBe("spooler-2");
  });
});

/**
 * The rule CLAUDE.md exists to protect: a vocabulary the browser and the server
 * both enforce lives in @tachy/contract, and the SPA re-exports it rather than
 * keeping a copy. A copy is how the admin panel and the vault came to disagree
 * about what a valid key looked like.
 */
describe("vocab re-exports the contract", () => {
  it.each([
    ["CONFIDENCES", CONFIDENCES],
    ["KNOWLEDGE_STATUSES", KNOWLEDGE_STATUSES],
    ["RESOLUTION_CLARITIES", RESOLUTION_CLARITIES],
  ])("%s matches @tachy/contract", (name, value) => {
    expect(value).toEqual((contract as Record<string, unknown>)[name]);
  });
});

describe("the accent palette", () => {
  it("names all sixteen ANSI colours", () => {
    expect(ANSI16).toHaveLength(16);
    expect(new Set(ANSI16.map((c) => c.name)).size).toBe(16);
  });

  it("gives every entry a usable hex value", () => {
    for (const c of ANSI16) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
