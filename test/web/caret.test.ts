import { describe, expect, it } from "vitest";
import { caretSide } from "../../packages/web/src/tui/Caret.svelte";

describe("caretSide", () => {
  it("centres between two letters", () => {
    expect(caretSide("hello", 2)).toBe("mid");
  });

  it("steps clear of a letter that ends a word", () => {
    expect(caretSide("hello", 5)).toBe("tail");
    expect(caretSide("hello world", 5)).toBe("tail");
  });

  it("steps clear of a letter that starts a word", () => {
    expect(caretSide("hello", 0)).toBe("lead");
    expect(caretSide("hello world", 6)).toBe("lead");
  });

  it("starts at the point when no letter is beside it", () => {
    expect(caretSide("", 0)).toBe("bare");
    expect(caretSide("x ", 2)).toBe("bare");
    expect(caretSide("a\n\nb", 2)).toBe("bare");
  });
});
