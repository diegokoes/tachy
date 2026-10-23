import { describe, expect, it } from "vitest";
import {
  EMBEDDING_SPEC,
  MAX_QUERY_CHARS,
  MAX_QUERY_WINDOWS,
  queryWindows,
} from "@tachy/core/search";

const windowChars = EMBEDDING_SPEC.codeChunkChars;

/** A message of `chars` characters that names its own number. */
const message = (n: number, chars: number) =>
  `Message ${n}. ` + "word ".repeat(Math.ceil(chars / 5));

describe("queryWindows", () => {
  it("gives each message a window of its own", () => {
    const first = message(1, 300);
    const second = message(2, 300);
    expect(queryWindows([first, second])).toEqual([
      first.trim(),
      second.trim(),
    ]);
    expect(queryWindows(["  ", ""])).toEqual([]);
  });

  it("puts a short message in the window before it", () => {
    const symptom =
      "Since the upgrade the handheld scanner shows offline and cannot be paired again.";
    expect(queryWindows([symptom, "Thanks!", "Any news?"])).toEqual([
      `${symptom}\n\nThanks!\n\nAny news?`,
    ]);
  });

  it("cuts a message longer than the model reads whole", () => {
    const windows = queryWindows(["x".repeat(windowChars * 3)]);
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows)
      expect(window.length).toBeLessThanOrEqual(windowChars);
  });

  it("keeps the first window and the latest within the budget", () => {
    const thread = Array.from({ length: 40 }, (_, i) => message(i + 1, 1000));
    const windows = queryWindows(thread);
    expect(windows.length).toBeLessThanOrEqual(MAX_QUERY_WINDOWS);
    expect(windows.join("").length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    expect(windows[0]).toContain("Message 1.");
    expect(windows.at(-1)).toContain("Message 40.");
    expect(windows.some((window) => window.includes("Message 2."))).toBe(false);
  });
});
