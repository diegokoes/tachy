import { describe, expect, it } from "vitest";
import {
  blankDraft,
  createPayload,
  draftFrom,
  draftProblems,
  editedFields,
  entryPatch,
  fieldLabel,
  holdsProperties,
  rebase,
  withStatus,
  type EntryDraft,
} from "../../packages/web/src/knowledge/draft";
import type { KnowledgeRow } from "../../packages/web/src/knowledge/rows";

const row: KnowledgeRow = {
  id: "e1",
  work_item_id: null,
  status: "deprecated",
  superseded_by: "e2",
  title: "Spooler stalls on long batches",
  issue_summary: "The spooler halts past 500 labels.",
  root_cause: null,
  resolution: "Restart the spooler.",
  investigation: null,
  resolution_pattern: null,
  component_slug: "spooler",
  product_area: "Fleet Trace / Spooler",
  customer_slug: "harbourside-foods",
  customer_unit_slug: null,
  confidence: "medium",
  cloud: null,
  resolution_clarity: null,
  hidden_fix: null,
  symptoms: ["queue never drains"],
  signals: null,
  tags: ["printing"],
  related_links: [],
  version: 3,
};

const edited = (changes: Partial<EntryDraft>): EntryDraft => ({
  ...draftFrom(row),
  ...changes,
});

describe("an entry's draft", () => {
  it("reads empty fields as empty text and empty lists", () => {
    const draft = draftFrom(row);
    expect(draft.rootCause).toBe("");
    expect(draft.signals).toEqual([]);
    expect(draft.hiddenFix).toBe(false);
    expect(draft.component).toBe("spooler");
    expect(draft.customerSlug).toBe("harbourside-foods");
  });

  it("sends nothing while nothing changed, whitespace included", () => {
    const before = draftFrom(row);
    expect(entryPatch(before, before)).toEqual({});
    expect(
      entryPatch(before, edited({ resolution: " Restart the spooler. \n" })),
    ).toEqual({});
  });

  it("sends only the changed fields, an emptied one as null", () => {
    const before = draftFrom(row);
    const after = edited({
      title: "  Spooler halts past 500 labels ",
      resolution: "",
      investigation: "1. Counted the labels per batch.",
      tags: ["printing", "spooler"],
      hiddenFix: true,
    });
    expect(entryPatch(before, after)).toEqual({
      title: "Spooler halts past 500 labels",
      resolution: null,
      investigation: "1. Counted the labels per batch.",
      tags: ["printing", "spooler"],
      hiddenFix: true,
    });
    expect(editedFields(before, after)).toEqual([
      "title",
      "resolution",
      "investigation",
      "tags",
      "hiddenFix",
    ]);
  });

  it("sends the component only when it was moved", () => {
    const before = draftFrom(row);
    expect(entryPatch(before, edited({ tags: [] }))).not.toHaveProperty(
      "component",
    );
    expect(entryPatch(before, edited({ component: "" }))).toEqual({
      component: null,
    });
  });

  it("creates with every field that holds something, and the API's defaults left out", () => {
    const draft: EntryDraft = {
      ...blankDraft(),
      title: "Spooler stalls",
      issueSummary: "The spooler halts.",
      symptoms: ["queue never drains"],
    };
    expect(createPayload(draft)).toEqual({
      title: "Spooler stalls",
      issueSummary: "The spooler halts.",
      symptoms: ["queue never drains"],
    });
    expect(createPayload({ ...draft, status: "draft" })).toMatchObject({
      status: "draft",
    });
  });

  it("keeps a replacement only on a deprecated entry", () => {
    const draft = draftFrom(row);
    expect(withStatus(draft, "deprecated").supersededBy).toBe("e2");
    expect(withStatus(draft, "approved")).toMatchObject({
      status: "approved",
      supersededBy: null,
    });
  });

  it("names its fields the way the page does", () => {
    expect(
      editedFields(
        draftFrom(row),
        edited({ issueSummary: "", cloud: "qa" }),
      ).map(fieldLabel),
    ).toEqual(["summary", "environment"]);
  });

  it("holds properties only once one of them is set", () => {
    expect(holdsProperties(blankDraft())).toBe(false);
    expect(holdsProperties({ ...blankDraft(), hiddenFix: true })).toBe(true);
    expect(holdsProperties(draftFrom(row))).toBe(true);
  });

  it("lays its edits over a newer saved version, theirs kept elsewhere", () => {
    const before = draftFrom(row);
    const mine = edited({ resolution: "Raise the batch limit." });
    const theirs = edited({
      resolution: "Restart twice.",
      tags: ["printing", "firmware"],
    });
    expect(rebase(theirs, before, mine)).toEqual({
      ...theirs,
      resolution: "Raise the batch limit.",
    });
  });
});

describe("what keeps a draft from being saved", () => {
  it("is nothing for a sound draft", () => {
    expect(draftProblems(draftFrom(row))).toEqual({});
  });

  it("is an empty or over-long title", () => {
    expect(draftProblems(edited({ title: "  " })).title).toBe(
      "a title is required",
    );
    expect(draftProblems(edited({ title: "x".repeat(81) })).title).toBe(
      "a title fits 80 characters",
    );
  });

  it("is a missing summary only where one is required", () => {
    const unsummed = edited({ issueSummary: "" });
    expect(draftProblems(unsummed)).toEqual({});
    expect(draftProblems(unsummed, { requireSummary: true }).issueSummary).toBe(
      "a summary is required",
    );
  });

  it("is an environment that is no slug, or a link that is no web address", () => {
    expect(draftProblems(edited({ cloud: "Prod EU" }))).toHaveProperty("cloud");
    expect(
      draftProblems(edited({ relatedLinks: ["DevOps#50912"] })),
    ).toHaveProperty("relatedLinks");
  });
});
