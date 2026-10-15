/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { WorkItemReading } from "@tachy/contract";
import {
  DEFAULT_FILTER,
  fieldText,
  itemsPath,
  shownSections,
  sortBy,
} from "../../packages/web/src/work-items/board";
import { itemHtml } from "../../packages/web/src/work-items/itemHtml";

describe("board list", () => {
  it("flips the direction on the same column, starts dates newest first", () => {
    const changed = { ...DEFAULT_FILTER };
    expect(sortBy(changed, "changed")).toEqual({
      sort: "changed",
      direction: "asc",
    });
    expect(sortBy(changed, "created")).toEqual({
      sort: "created",
      direction: "desc",
    });
    expect(sortBy(changed, "title")).toEqual({
      sort: "title",
      direction: "asc",
    });
  });

  it("asks only for the filters that are set", () => {
    expect(itemsPath("p1", DEFAULT_FILTER, 0, 50)).toBe(
      "/work-items/projects/p1/items?sort=changed&direction=desc&scope=all&offset=0&limit=50",
    );
    expect(
      itemsPath(
        "p1",
        { ...DEFAULT_FILTER, type: "Bug", text: "  print " },
        50,
        50,
      ),
    ).toContain("&type=Bug&q=print");
  });
});

const reading = (
  fields: Record<string, unknown>,
  layout: WorkItemReading["layout"]["layout"],
): WorkItemReading => ({
  item: {} as WorkItemReading["item"],
  fields,
  relations: {
    parent: null,
    children: [],
    related: [],
    pull_requests: [],
    commits: [],
  },
  layout: {
    layout,
    fields: {
      "System.Description": { name: "Description", type: "html" },
      "Custom.ApprovalDate": { name: "Approval date", type: "dateTime" },
      "Custom.Approver": { name: "Approver", type: "identity" },
      "Microsoft.VSTS.Common.Priority": { name: "Priority", type: "integer" },
      "System.AssignedTo": { name: "Assigned To", type: "identity" },
    },
  },
});

describe("item fields", () => {
  const fields = {
    "System.Description": "<p>Blank page</p>",
    "Custom.ApprovalDate": "2026-10-01T08:00:00Z",
    "Custom.Approver": { displayName: "Ana Ruiz", uniqueName: "ana@x.io" },
    "Microsoft.VSTS.Common.Priority": 2,
    "System.AssignedTo": { displayName: "Ben" },
  };

  it("follows the form's places and leaves out what holds nothing", () => {
    const sections = shownSections(
      reading(
        { ...fields, "Custom.Empty": "" },
        {
          body: ["System.Description"],
          groups: [
            { label: null, fields: ["System.AssignedTo"] },
            {
              label: "Approval",
              fields: [
                "Custom.ApprovalDate",
                "Custom.Approver",
                "Custom.Empty",
              ],
            },
          ],
        },
      ),
    );
    expect(sections.body.map((field) => field.label)).toEqual(["Description"]);
    expect(sections.groups).toEqual([
      {
        label: "Approval",
        fields: [
          {
            ref: "Custom.ApprovalDate",
            label: "Approval date",
            kind: "date",
            value: "2026-10-01T08:00:00Z",
          },
          {
            ref: "Custom.Approver",
            label: "Approver",
            kind: "text",
            value: "Ana Ruiz",
          },
        ],
      },
    ]);
  });

  it("lists every field with a value when the form is unknown", () => {
    const sections = shownSections(reading(fields, null));
    expect(sections.body.map((field) => field.ref)).toEqual([
      "System.Description",
    ]);
    expect(sections.groups[0].fields.map((field) => field.ref)).toEqual([
      "Custom.ApprovalDate",
      "Custom.Approver",
      "Microsoft.VSTS.Common.Priority",
    ]);
  });

  it("reads people, flags and numbers as text", () => {
    expect(fieldText({ uniqueName: "a@x.io" })).toBe("a@x.io");
    expect(fieldText(false)).toBe("no");
    expect(fieldText(0)).toBe("0");
    expect(fieldText(null)).toBeNull();
  });
});

describe("item HTML", () => {
  const source = { slug: "ado", itemId: "42" };

  it("serves pasted pictures through tachy and drops pictures from elsewhere", () => {
    const html = itemHtml(
      '<p>see <img src="https://dev.azure.com/org/_apis/wit/attachments/0F8FAD5B-D9CB-469F-A165-70867728950E?fileName=a.png"><img src="https://tracker.example/p.gif" alt="pixel"></p>',
      source,
    );
    expect(html).toContain(
      'src="/api/work-items/ado/42/attachments/0f8fad5b-d9cb-469f-a165-70867728950e"',
    );
    expect(html).not.toContain("tracker.example");
    expect(html).toContain("pixel");
  });

  it("strips script and opens links in a new tab", () => {
    const html = itemHtml(
      '<a href="https://x.io">x</a><script>alert(1)</script>',
      source,
    );
    expect(html).not.toContain("script");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
