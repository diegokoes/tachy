/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTRA_FILTERS,
  applyExtras,
  byKey,
  loadFilters,
  pruneValues,
  saveFilters,
  type Facets,
  type FacetKey,
} from "../../packages/web/src/lib/library/filters.svelte";
import {
  CONFIDENCES,
  RESOLUTION_CLARITIES,
} from "../../packages/web/src/lib/vocab";

beforeEach(() => localStorage.clear());

describe("the extras catalogue", () => {
  it("keys every filter uniquely and gives each a query parameter", () => {
    const keys = EXTRA_FILTERS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of EXTRA_FILTERS) {
      expect(f.param).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.any).toBeTruthy();
    }
  });

  /** An enum filter with no options would render an empty, unusable select. */
  it("gives every enum filter its option list", () => {
    for (const f of EXTRA_FILTERS.filter((x) => x.kind === "enum"))
      expect(f.options?.length).toBeGreaterThan(0);
  });

  /**
   * The vocabularies come from @tachy/contract via vocab.ts, which is the rule
   * CLAUDE.md exists to protect: a copy in the SPA is how the admin panel and
   * the vault came to disagree about what a valid key looked like.
   */
  it("draws its enum options from the shared vocabulary", () => {
    expect(byKey("confidence")?.options).toEqual(CONFIDENCES);
    expect(byKey("resolution_clarity")?.options).toEqual(RESOLUTION_CLARITIES);
  });

  it("returns undefined for a key it does not offer", () => {
    expect(byKey("nope" as FacetKey)).toBeUndefined();
  });
});

describe("persistence", () => {
  it("round-trips what is on screen", () => {
    saveFilters({ shown: ["cloud"], values: { cloud: "prod" } });
    expect(loadFilters()).toEqual({
      shown: ["cloud"],
      values: { cloud: "prod" },
    });
  });

  it("starts empty when nothing is stored", () => {
    expect(loadFilters()).toEqual({ shown: [], values: {} });
  });

  it("survives a corrupt entry rather than throwing at mount", () => {
    localStorage.setItem("tachy-library-filters", "{not json");
    expect(loadFilters()).toEqual({ shown: [], values: {} });
  });

  /** A key from an older build must not reach byKey() as undefined later. */
  it("drops a stored key this build no longer offers", () => {
    localStorage.setItem(
      "tachy-library-filters",
      JSON.stringify({ shown: ["cloud", "retired_facet"], values: {} }),
    );
    expect(loadFilters().shown).toEqual(["cloud"]);
  });

  it("does not throw when storage refuses the write", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveFilters({ shown: [], values: {} })).not.toThrow();
    spy.mockRestore();
  });
});

describe("pruneValues", () => {
  const facets: Facets = {
    cloud: [{ value: "prod", count: 3 }],
    tags: [
      { value: "network", count: 2 },
      { value: "hardware", count: 1 },
    ],
  };

  /**
   * A stale facet value narrows the list to nothing with no visible cause,
   * which reads as "the library is empty" rather than "this filter is stale".
   */
  it("drops a facet value the current counts no longer offer", () => {
    expect(pruneValues(["cloud"], { cloud: "qa" }, facets)).toEqual({});
    expect(pruneValues(["cloud"], { cloud: "prod" }, facets)).toEqual({
      cloud: "prod",
    });
  });

  /** An enum value with no rows behind it right now is still a fair question. */
  it("keeps an enum value that no row currently has", () => {
    expect(
      pruneValues(["confidence"], { confidence: CONFIDENCES[0] }, {}),
    ).toEqual({ confidence: CONFIDENCES[0] });
  });

  it("drops an enum value outside the vocabulary", () => {
    expect(pruneValues(["confidence"], { confidence: "wishful" }, {})).toEqual(
      {},
    );
  });

  it("keeps the tags that survive and drops the rest", () => {
    expect(
      pruneValues(["tags"], { tags: "network,gone,hardware" }, facets),
    ).toEqual({ tags: "network,hardware" });
  });

  it("drops the tag filter when none of its tags survive", () => {
    expect(pruneValues(["tags"], { tags: "gone,also-gone" }, facets)).toEqual(
      {},
    );
  });

  it("leaves values for filters that are not on screen alone", () => {
    expect(pruneValues([], { cloud: "qa" }, facets)).toEqual({ cloud: "qa" });
  });
});

describe("applyExtras", () => {
  it("writes each active extra under its own parameter name", () => {
    const p = applyExtras(
      new URLSearchParams({ q: "spooler" }),
      ["cloud", "resolution_clarity"],
      { cloud: "prod", resolution_clarity: RESOLUTION_CLARITIES[0] },
    );
    expect(p.get("q")).toBe("spooler");
    expect(p.get("cloud")).toBe("prod");
    expect(p.get("resolution_clarity")).toBe(RESOLUTION_CLARITIES[0]);
  });

  it("leaves out an extra that is shown but unset", () => {
    const p = applyExtras(new URLSearchParams(), ["cloud"], {});
    expect(p.has("cloud")).toBe(false);
  });
});
