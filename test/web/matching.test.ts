/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  entryText,
  excerpt,
  terms,
} from "../../packages/web/src/lib/library/matching";

const text = (segs: { t: string }[]) => segs.map((s) => s.t).join("");
const hits = (segs: { t: string; hit?: boolean }[]) =>
  segs.filter((s) => s.hit).map((s) => s.t);

describe("terms", () => {
  it("keeps words worth centring an excerpt on", () => {
    expect(terms("printer stops mid-batch")).toEqual([
      "printer",
      "stops",
      "mid",
      "batch",
    ]);
  });

  /** Two-letter noise would match everywhere and centre the excerpt nowhere. */
  it("drops words shorter than three characters", () => {
    expect(terms("in the queue")).toEqual(["the", "queue"]);
  });

  it("deduplicates and lowercases", () => {
    expect(terms("Queue queue QUEUE")).toEqual(["queue"]);
  });

  it("handles a query with nothing in it", () => {
    expect(terms("")).toEqual([]);
    expect(terms("a b !!")).toEqual([]);
  });

  it("keeps non-ascii words", () => {
    expect(terms("données müller")).toEqual(["données", "müller"]);
  });
});

describe("excerpt", () => {
  const body =
    "The printer stops mid-batch when the queue is deep. " +
    "Operators restart the console, which clears it for a shift. " +
    "The real cause is that the dispatcher retries without backoff.";

  it("marks the query's words as hits", () => {
    const segs = excerpt(body, "dispatcher");
    expect(hits(segs)).toContain("dispatcher");
  });

  it("falls back to the head of the text for a purely semantic match", () => {
    const segs = excerpt(body, "unrelated words entirely");
    expect(hits(segs)).toEqual([]);
    expect(text(segs).startsWith("The printer stops")).toBe(true);
  });

  it("falls back to the head when the query has no usable terms", () => {
    expect(text(excerpt(body, "a b")).startsWith("The printer")).toBe(true);
  });

  /** Wiki-style: fragments around each hit, not one slab from the first one. */
  it("joins several fragments rather than returning one long run", () => {
    const segs = excerpt(body, "printer backoff");
    expect(text(segs)).toMatch(/…/);
    expect(hits(segs).length).toBeGreaterThan(1);
  });

  it("caps the number of fragments", () => {
    const many = Array.from({ length: 40 }, (_, i) => `spooler item ${i}`).join(
      ". ",
    );
    const segs = excerpt(many, "spooler", 40, 2);
    // Two windows means at most one interior ellipsis plus the edges.
    expect(text(segs).split("…").length).toBeLessThanOrEqual(4);
  });

  it("collapses whitespace so a fragment is one line", () => {
    const segs = excerpt("a\n\n  printer   stops\tmid-batch", "printer");
    expect(text(segs)).not.toMatch(/\s\s|\n|\t/);
  });

  it("returns something for empty text", () => {
    expect(text(excerpt("", "printer"))).toBe("");
  });
});

describe("entryText", () => {
  it("returns the field the query actually landed in", () => {
    expect(
      entryText(
        ["the dispatcher retries without backoff", "restart the service"],
        "restart service",
      ),
    ).toBe("restart the service");
  });

  it("prefers the first present field when the query matches nothing", () => {
    expect(entryText(["root cause", "resolution"], "unrelated")).toBe(
      "root cause",
    );
  });

  it("skips fields that are empty, blank or absent", () => {
    expect(entryText([null, "   ", undefined, "resolution"], "")).toBe(
      "resolution",
    );
  });

  it("returns undefined when there is nothing to show", () => {
    expect(entryText([null, undefined, "  "], "printer")).toBeUndefined();
  });
});
