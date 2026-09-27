/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { ComposerProject, FieldSpec } from "@tachy/contract";
import {
  isAzNew,
  matchProject,
  parseAz,
} from "../../packages/web/src/lib/work-items/azCommand";
import {
  fieldForName,
  layoutFields,
  missingRequired,
} from "../../packages/web/src/lib/work-items/layout";
import {
  typeColor,
  typeIcon,
} from "../../packages/web/src/lib/work-items/ado-icons";
import {
  toHtml,
  toPreview,
} from "../../packages/web/src/lib/work-items/ticketMarkdown";
import { ICONS } from "../../packages/web/src/lib/tui/icons";

const project = (name: string, key = name): ComposerProject => ({
  id: name.toLowerCase().replace(/\s/g, "-"),
  name,
  external_key: key,
  source_slug: "ado",
  team_slug: "t",
  product_slug: null,
});
const projects = [
  project("Portal"),
  project("Portal Mobile"),
  project("Core", "CORE-2024"),
];

describe("/az line", () => {
  it("offers subcommands, then projects, then types", () => {
    expect(parseAz("/az ", projects)).toEqual({ stage: "sub", query: "" });
    expect(parseAz("/az ne", projects)).toEqual({ stage: "sub", query: "ne" });
    expect(parseAz("/az new ", projects)).toEqual({
      stage: "project",
      query: "",
    });
    expect(parseAz("/az new por", projects)).toEqual({
      stage: "project",
      query: "por",
    });
    expect(parseAz("/az new Portal Mobile Bu", projects)).toMatchObject({
      stage: "type",
      project: { name: "Portal Mobile" },
      query: "Bu",
    });
  });

  it("matches a project by its ADO key too, and needs the space after it", () => {
    expect(matchProject("CORE-2024 Task", projects)?.project.name).toBe("Core");
    expect(matchProject("Portal", projects)).toBeNull();
  });

  it("is not an /az line otherwise", () => {
    expect(parseAz("/az", projects)).toBeNull();
    expect(parseAz("/azure new", projects)).toBeNull();
    expect(parseAz("/az explain 12", projects)).toBeNull();
    expect(isAzNew("/az new Portal Bug")).toBe(true);
    expect(isAzNew("/az newer")).toBe(false);
    expect(isAzNew("/az explain 12")).toBe(false);
  });
});

const f = (
  reference_name: string,
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({
  reference_name,
  name: reference_name.split(".").pop()!,
  required: false,
  ...extra,
});

describe("field layout", () => {
  const fields = [
    f("System.Title", { required: true }),
    f("System.State", { required: true }),
    f("System.CreatedBy", { read_only: true }),
    f("Microsoft.VSTS.TCM.ReproSteps", { type: "html" }),
    f("System.Description", { type: "html" }),
    f("Microsoft.VSTS.Common.Severity", {
      required: true,
      allowed_values: ["1", "2"],
    }),
    f("System.AreaPath", { type: "treePath" }),
    f("Custom.Customer", { required: true }),
    f("Custom.Notes"),
    f("System.History", { type: "history" }),
  ];

  it("puts prose first, then the usual fields, then what is required, then the rest", () => {
    const l = layoutFields(fields);
    const refs = (xs: FieldSpec[]) => xs.map((x) => x.reference_name);
    expect(refs(l.body)).toEqual([
      "Microsoft.VSTS.TCM.ReproSteps",
      "System.Description",
    ]);
    expect(refs(l.core)).toEqual([
      "System.AreaPath",
      "Microsoft.VSTS.Common.Severity",
    ]);
    expect(refs(l.required)).toEqual(["Custom.Customer"]);
    expect(refs(l.more)).toEqual(["Custom.Notes"]);
  });

  it("counts the title and required fields ADO will not fill", () => {
    expect(missingRequired(fields, " ", { "Custom.Customer": "acme" })).toEqual(
      ["System.Title", "Microsoft.VSTS.Common.Severity"],
    );
    const withDefault = fields.map((x) =>
      x.reference_name === "Microsoft.VSTS.Common.Severity"
        ? { ...x, default_value: "2" }
        : x,
    );
    expect(
      missingRequired(withDefault, "t", { "Custom.Customer": "acme" }),
    ).toEqual([]);
  });

  it("maps ADO's field names back to reference names", () => {
    expect(fieldForName(fields, "Severity")).toBe(
      "Microsoft.VSTS.Common.Severity",
    );
    expect(fieldForName(fields, "System.AreaPath")).toBe("System.AreaPath");
    expect(fieldForName(fields, "Nope")).toBeNull();
  });
});

describe("type glyphs", () => {
  it("maps ADO's stock ids onto registered marks, generic otherwise", () => {
    expect(typeIcon("icon_insect")).toBe("bug");
    expect(typeIcon("icon_crown")).toBe("wiEpic");
    expect(typeIcon("icon_unheard_of")).toBe("wiGeneric");
    expect(typeIcon(null)).toBe("wiGeneric");
    for (const id of [
      "icon_insect",
      "icon_clipboard",
      "icon_book",
      "icon_trophy",
    ])
      expect(ICONS[typeIcon(id)]).toBeDefined();
  });

  it("only passes a well-formed colour into CSS", () => {
    expect(typeColor("CC293D")).toBe("#CC293D");
    expect(typeColor("red;background:url(x)")).toBeNull();
  });
});

describe("ticket markdown", () => {
  it("keeps pasted-image references through sanitizing", () => {
    const html = toHtml("steps\n\n![shot](attachment:k1)");
    expect(html).toContain('src="attachment:k1"');
  });

  it("still strips script and javascript: links", () => {
    expect(toHtml("<script>x()</script>hi")).not.toContain("<script");
    expect(toHtml("[a](javascript:alert(1))")).not.toMatch(
      /href="javascript:/i,
    );
  });

  it("previews pasted images from their local blobs", () => {
    expect(
      toPreview("![s](attachment:k1)", new Map([["k1", "blob:abc"]])),
    ).toContain('src="blob:abc"');
  });
});
