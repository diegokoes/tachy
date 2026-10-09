import { describe, expect, it } from "vitest";
import { tallyCalls, tallyLabel } from "../../packages/web/src/chat/toolCalls";

describe("tallyCalls", () => {
  it("counts back-to-back repeats and keeps the order called", () => {
    const tallies = tallyCalls([
      "list_repos",
      "search_code",
      "search_code",
      "search_code",
      "read_code_file",
      "search_code",
      "search_code",
    ]);
    expect(tallies.map(tallyLabel)).toEqual([
      "list_repos",
      "search_code ×3",
      "read_code_file",
      "search_code ×2",
    ]);
  });

  it("is empty for no calls", () => {
    expect(tallyCalls([])).toEqual([]);
  });
});
