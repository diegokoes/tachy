import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runTool } from "../../packages/mcp/src/index";
import { badInput, rememberSecret } from "@tachy/core/infra";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

describe("runTool envelope", () => {
  beforeEach(resetData);

  it("passes a successful result through unchanged", async () => {
    const ok = { content: [{ type: "text" as const, text: "ok" }] };
    const response = (await runTool(
      "noop",
      async () => ok,
      {},
      {},
    )) as ToolResult;
    expect(response).toEqual(ok);
    expect(response.isError).toBeUndefined();
  });

  it("masks a secret this process holds, in a result and in an error", async () => {
    rememberSecret("canary-secret-in-a-tool-result");
    const result = (await runTool(
      "leaky_result",
      async () => ({
        content: [
          { type: "text" as const, text: "got canary-secret-in-a-tool-result" },
        ],
      }),
      {},
      {},
    )) as ToolResult;
    expect(result.content[0].text).toBe("got [SECRET]");

    const failed = (await runTool(
      "leaky_error",
      async () => {
        throw new Error("upstream said canary-secret-in-a-tool-result");
      },
      {},
      {},
    )) as ToolResult;
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toBe("upstream said [SECRET]");
  });

  it("turns a thrown AppError into a clean tool error", async () => {
    const response = (await runTool(
      "boom",
      async () => {
        throw badInput("bad thing");
      },
      {},
      {},
    )) as ToolResult;
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe("bad thing");
  });

  it("surfaces a real core failure (unknown resolution_pattern) as a tool error, not a rejection", async () => {
    const response = (await runTool(
      "save_knowledge_entry",
      async () =>
        saveKnowledgeEntry({
          issueSummary: "x",
          resolutionPattern: "does-not-exist",
        }),
      {},
      {},
    )) as ToolResult;
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/resolution_pattern/i);
  });
});
