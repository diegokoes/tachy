import { describe, expect, it } from "vitest";
import {
  tallyCalls,
  tallyLabel,
  toolWords,
} from "../../packages/web/src/chat/toolCalls";

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
      "list repos",
      "searched code ×3",
      "read a file",
      "searched code ×2",
    ]);
  });

  it("is empty for no calls", () => {
    expect(tallyCalls([])).toEqual([]);
  });
});

describe("tool words", () => {
  it("says what a known tool did", () => {
    expect(toolWords("search_knowledge")).toBe("searched the library");
    expect(toolWords("mcp__tachy__get_context")).toBe("read the ticket");
  });

  it("spells out a tool it has no phrase for", () => {
    expect(toolWords("list_customer_units")).toBe("list customer units");
  });

  it("names a linked server's tool by its server", () => {
    expect(toolWords("mcp__jira__get_issue")).toBe("jira: get issue");
  });
});
