import { describe, expect, it } from "vitest";
import { approvalTitle } from "../../packages/web/src/chat/approvalTitle";

describe("approval titles", () => {
  it("says the action and the ticket it acts on", () => {
    expect(
      approvalTitle("post_private_note", {
        source: "freshdesk",
        external_id: "4521",
        body: "…",
      }),
    ).toBe("post a private note · freshdesk #4521");
  });

  it("names the project when there is no item yet", () => {
    expect(
      approvalTitle("mcp__tachy__create_ado_work_item", {
        source: "eng-ado",
        project: "Portal",
      }),
    ).toBe("create a work item · eng-ado Portal");
  });

  it("falls back to the tool's name in words, alone when it has no target", () => {
    expect(approvalTitle("set_project_area_map", {})).toBe(
      "set project area map",
    );
    expect(approvalTitle("save_knowledge_entry", { issue_summary: "x" })).toBe(
      "save an entry",
    );
  });
});
