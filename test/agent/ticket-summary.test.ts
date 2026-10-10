import { describe, expect, it } from "vitest";
import { type RawWorkItem } from "@tachy/core/sources";
import {
  parseSummary,
  summaryPrompt,
} from "../../packages/agent/src/ticket-summary";

const item: RawWorkItem = {
  externalId: "42",
  kind: "ticket",
  title: "printer stops mid-batch",
  raw: {},
  messages: [
    {
      externalId: "1",
      direction: "incoming",
      visibility: "public",
      authorLabel: "Ana",
      createdAt: "2026-06-16T08:00:00Z",
      bodyText: "The printer stops mid-batch and the queue never drains.",
    },
  ],
};

describe("summaryPrompt", () => {
  it("carries the answer's schema and the thread as a script", () => {
    const prompt = summaryPrompt(item);
    expect(prompt).toContain('"timeline"');
    expect(prompt).toContain("What was already attempted or ruled out");
    expect(prompt).toContain("Ana (2026-06-16):");
    expect(prompt).toContain("the queue never drains");
  });
});

describe("parseSummary", () => {
  const answer = {
    problem: "The printer stops mid-batch.",
    status: "Open.",
    timeline: [{ date: "2026-06-16", event: "Reported." }],
    tried: [],
  };

  it("reads the object out of whatever the model wrapped it in", () => {
    expect(
      parseSummary(
        `Here it is:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
      ),
    ).toEqual(answer);
  });

  it("is null for an answer of another shape, or none", () => {
    expect(parseSummary(JSON.stringify({ problem: "only this" }))).toBeNull();
    expect(parseSummary("I could not read the ticket.")).toBeNull();
  });
});
