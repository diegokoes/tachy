import { describe, expect, it } from "vitest";
import {
  EMBEDDING_SPEC,
  MAX_QUERY_WINDOWS,
  queryWindows,
} from "@tachy/core/search";

const windowChars = EMBEDDING_SPEC.codeChunkChars;

/** `n` paragraphs, each most of a window long and naming its own number. */
const paragraphs = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Message ${i + 1}. ` + "word ".repeat(windowChars / 6),
  ).join("\n\n");

describe("queryWindows", () => {
  it("keeps a short text as one window", () => {
    expect(queryWindows("Scanner offline after the update.")).toEqual([
      "Scanner offline after the update.",
    ]);
    expect(queryWindows("  ")).toEqual([]);
  });

  it("cuts a long text into windows the model reads whole", () => {
    const windows = queryWindows(paragraphs(3));
    expect(windows).toHaveLength(3);
    for (const window of windows)
      expect(window.length).toBeLessThanOrEqual(windowChars * 1.5);
  });

  it("splits one paragraph longer than a window", () => {
    const windows = queryWindows("x".repeat(windowChars * 3));
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows)
      expect(window.length).toBeLessThanOrEqual(windowChars);
  });

  it(`keeps the first window and the latest past ${MAX_QUERY_WINDOWS}`, () => {
    const windows = queryWindows(paragraphs(12));
    expect(windows).toHaveLength(MAX_QUERY_WINDOWS);
    expect(windows[0]).toContain("Message 1.");
    expect(windows[1]).toContain("Message 6.");
    expect(windows.at(-1)).toContain("Message 12.");
  });
});
