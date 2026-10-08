import { describe, expect, it } from "vitest";
import {
  checklistFor,
  parseTicketReview,
  reviewPrompt,
} from "../../packages/agent/src/ticket-review";

const request = {
  type: "Bug",
  title: "Label printer jams on batch print",
  fields: [
    {
      ref: "Microsoft.VSTS.TCM.ReproSteps",
      name: "Repro Steps",
      value: "1. print 50 labels",
    },
  ],
  images: 2,
  context: [
    {
      source: "support-desk",
      external_id: "5541",
      title: "Printer stuck at 023",
      text: "Customer on 4.2.1 says it jams after 40 labels.",
    },
  ],
};

describe("ticket review prompt", () => {
  it("reads as the developer for the type's family", () => {
    expect(checklistFor("Bug")).toMatch(/steps/);
    expect(checklistFor("User Story")).toMatch(/acceptance criteria/);
    expect(checklistFor("Product Backlog Item")).toMatch(/acceptance criteria/);
    expect(checklistFor("Change Request")).toMatch(/rolled back/);
    expect(checklistFor("Task")).toMatch(/done/);
    expect(checklistFor("Test Plan")).toMatch(/without asking/);
  });

  it("carries fields by reference name, the image count and the context", () => {
    const prompt = reviewPrompt(request);
    expect(prompt).toContain(
      "[System.Title] Label printer jams on batch print",
    );
    expect(prompt).toContain(
      "[Microsoft.VSTS.TCM.ReproSteps] Repro Steps:\n1. print 50 labels",
    );
    expect(prompt).toContain("pasted 2 image(s)");
    expect(prompt).toContain("--- support-desk #5541: Printer stuck at 023");
  });

  it("passes every piece of free text through the scrubber", () => {
    const seen: string[] = [];
    reviewPrompt(request, (text) => {
      seen.push(text);
      return text;
    });
    expect(seen).toEqual(
      expect.arrayContaining([
        request.title,
        "1. print 50 labels",
        "Printer stuck at 023",
        request.context[0].text,
      ]),
    );
  });
});

describe("parseTicketReview", () => {
  const known = ["Microsoft.VSTS.TCM.ReproSteps"];

  it("keeps well-formed findings, numbered, with suggestions when given", () => {
    const review = parseTicketReview(
      'Sure! {"readiness":"almost","summary":"Close, but I cannot reproduce it yet.","findings":[{"field":"Microsoft.VSTS.TCM.ReproSteps","kind":"gap","message":"No expected result.","suggestion":"Expected: all 50 labels print."},{"field":"System.Title","kind":"improve","message":"Say which model."}]}',
      known,
    );
    expect(review).toEqual({
      available: true,
      readiness: "almost",
      summary: "Close, but I cannot reproduce it yet.",
      findings: [
        {
          id: "f1",
          field: "Microsoft.VSTS.TCM.ReproSteps",
          kind: "gap",
          message: "No expected result.",
          suggestion: "Expected: all 50 labels print.",
        },
        {
          id: "f2",
          field: "System.Title",
          kind: "improve",
          message: "Say which model.",
        },
      ],
    });
  });

  it("files a finding on an unknown field under general and fixes bad kinds", () => {
    const review = parseTicketReview(
      '{"findings":[{"field":"Custom.Nope","kind":"shrug","message":"x"}]}',
      known,
    );
    expect(review.findings[0]).toMatchObject({
      field: "general",
      kind: "improve",
    });
    expect(review.readiness).toBe("almost");
  });

  it("drops empty findings and caps the list at eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      field: "general",
      kind: "gap",
      message: i === 0 ? "" : `m${i}`,
    }));
    const review = parseTicketReview(JSON.stringify({ findings: many }), known);
    expect(review.findings).toHaveLength(8);
    expect(review.findings[0].message).toBe("m1");
  });

  it("never throws on garbage, and says the review was unreadable", () => {
    const review = parseTicketReview("I could not do that.", known);
    expect(review.available).toBe(true);
    expect(review.findings).toEqual([]);
    expect(review.summary).toMatch(/unreadable/);
  });
});
