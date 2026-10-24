import { describe, expect, it } from "vitest";
import { ASCII_ART } from "../../packages/web/src/tui/ascii";

describe("empty state drawings", () => {
  it("are at most five lines, each as wide as the others", () => {
    for (const [name, lines] of Object.entries(ASCII_ART)) {
      expect(lines.length, name).toBeLessThanOrEqual(5);
      const widths = new Set(lines.map((line) => [...line].length));
      expect(widths.size, name).toBe(1);
    }
  });
});
