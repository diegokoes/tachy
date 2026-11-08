import { describe, expect, it } from "vitest";
import {
  tallyCalls,
  tallyLabel,
  toolWords,
} from "../../packages/web/src/chat/toolCalls";

const calls = (...tools: string[]) =>
  tools.map((tool, n) => ({ tool, id: `call-${n}` }));

describe("tallyCalls", () => {
  it("counts back-to-back repeats and keeps the order called", () => {
    const tallies = tallyCalls(
      calls(
        "list_repos",
        "search_code",
        "search_code",
        "search_code",
        "read_code_file",
        "search_code",
        "search_code",
      ),
    );
    expect(tallies.map(tallyLabel)).toEqual([
      "list repos",
      "searched code ×3",
      "read a file",
      "searched code ×2",
    ]);
  });

  it("never counts a failed call with one that ran, and keeps its reason", () => {
    const [first, second, third] = calls(
      "save_knowledge_entry",
      "save_knowledge_entry",
      "save_knowledge_entry",
    );
    const tallies = tallyCalls([
      { ...first, failure: "symptoms must be array" },
      { ...second, failure: "title must not be empty" },
      third,
    ]);
    expect(tallies).toEqual([
      {
        tool: "save_knowledge_entry",
        count: 2,
        failure: "symptoms must be array",
      },
      { tool: "save_knowledge_entry", count: 1 },
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
