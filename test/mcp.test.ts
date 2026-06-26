import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../packages/mcp/src/index";
import { badInput, saveKnowledgeEntry } from "@tachy/core";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

describe("runTool envelope", () => {
  beforeEach(resetData);

  it("passes a successful result through unchanged", async () => {
    const ok = { content: [{ type: "text" as const, text: "ok" }] };
    const res = (await runTool("noop", async () => ok, {}, {})) as ToolResult;
    expect(res).toEqual(ok);
    expect(res.isError).toBeUndefined();
  });

  it("turns a thrown AppError into a clean tool error", async () => {
    const res = (await runTool("boom", async () => { throw badInput("bad thing"); }, {}, {})) as ToolResult;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("bad thing");
  });

  it("surfaces a real core failure (unknown resolution_pattern) as a tool error, not a rejection", async () => {
    const res = (await runTool(
      "save_knowledge_entry",
      async () => saveKnowledgeEntry({ issueSummary: "x", resolutionPattern: "does-not-exist" }),
      {},
      {},
    )) as ToolResult;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/resolution_pattern/i);
  });
});
