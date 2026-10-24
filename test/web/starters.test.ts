import { describe, expect, it } from "vitest";
import { startersFor } from "../../packages/web/src/chat/starters";

describe("chat starters", () => {
  it("offers a ticket, a source and a recipe on an empty composer", () => {
    expect(startersFor("").map((s) => s.line)).toEqual([
      "/analyze ",
      "@",
      "/recipe ",
    ]);
    expect(startersFor("  ")).toHaveLength(3);
  });

  it("steps aside once something is typed", () => {
    expect(startersFor("why does")).toEqual([]);
  });
});
