import { describe, expect, it } from "vitest";
import { formatBytes, windowText } from "@tachy/core/files";

const log = [
  "10:00 start",
  "10:01 connect ok",
  "10:02 ERROR timeout on line 3",
  "10:03 retry",
  "10:04 retry",
  "10:05 idle",
  "10:06 idle",
  "10:07 idle",
  "10:08 error: queue full",
  "10:09 stop",
].join("\n");

describe("windowText", () => {
  it("returns a short text whole", () => {
    expect(windowText("abc", { maxChars: 10 })).toEqual({
      text: "abc",
      chars: 3,
      truncated: false,
    });
  });

  it("cuts at maxChars and reads on from an offset", () => {
    const first = windowText("abcdefghij", { maxChars: 4 });
    expect(first).toMatchObject({ text: "abcd", chars: 10, truncated: true });
    const rest = windowText("abcdefghij", { offset: 4, maxChars: 100 });
    expect(rest).toMatchObject({ text: "efghij", truncated: false });
    expect(windowText("abc", { offset: 99, maxChars: 5 }).text).toBe("");
  });

  it("keeps only matching lines, with context and the offset they start at", () => {
    const shown = windowText(log, { maxChars: 10_000, match: ["error"] });
    expect(shown.matchedLines).toBe(2);
    const [first, second] = shown.text.split("\n\n");
    expect(first.split("\n")).toEqual([
      "[offset 0]",
      "10:00 start",
      "10:01 connect ok",
      "10:02 ERROR timeout on line 3",
      "10:03 retry",
      "10:04 retry",
    ]);
    expect(second.startsWith(`[offset ${log.indexOf("10:06")}]`)).toBe(true);
    expect(second).toContain("10:08 error: queue full");
    expect(second).not.toContain("10:05");
  });

  it("joins matches whose context touches into one block", () => {
    const shown = windowText(log, { maxChars: 10_000, match: ["retry"] });
    expect(shown.matchedLines).toBe(2);
    expect(shown.text.match(/\[offset/g)).toHaveLength(1);
  });

  it("says nothing matched with an empty text, and ignores blank terms", () => {
    expect(windowText(log, { maxChars: 100, match: ["absent"] })).toEqual({
      text: "",
      chars: 0,
      truncated: false,
      matchedLines: 0,
    });
    expect(windowText("abc", { maxChars: 10, match: [" "] }).text).toBe("abc");
  });
});

describe("formatBytes", () => {
  it("formats sizes at human scale", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(67658)).toBe("66 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });
});
