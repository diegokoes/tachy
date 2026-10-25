import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { flowAction, type FlowActionContext } from "@tachy/core/flows";
import { saveKnowledgeEntry } from "@tachy/core/knowledge";
import { resetData, sql } from "../database";

afterAll(() => sql.end());
beforeEach(resetData);

const context: FlowActionContext = {
  flowId: "flow",
  flowRunId: "run",
  stepId: "step",
  scope: {},
  userId: null,
  item: null,
  signal: new AbortController().signal,
  log: () => {},
  enqueue: async () => null,
};

describe("knowledge.search", () => {
  it("lists each past resolution under its entry's title", async () => {
    await saveKnowledgeEntry({
      status: "approved",
      title: "Spooler stalls on long batches",
      issueSummary: "The print spooler halts once a batch passes 500 labels.",
      resolution: "Restart the spooler service.",
    });
    const step = flowAction("knowledge.search");
    const output = (await step.run(
      context,
      step.params.parse({ query: "spooler stalls" }),
    )) as { count: number; text: string };
    expect(output.count).toBe(1);
    expect(output.text).toContain(
      "Spooler stalls on long batches → Restart the spooler service.",
    );
  });
});
