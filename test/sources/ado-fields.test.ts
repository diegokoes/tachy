import { describe, expect, it } from "vitest";
import {
  projectFields,
  workItemSchema,
  MAX_ALLOWED_VALUES,
} from "@tachy/source-azure-devops";

/** Shapes taken from the 7.1 REST reference's own sample responses. */
const typeFields = [
  {
    helpText: "The iteration within which this bug will be fixed",
    alwaysRequired: false,
    defaultValue: null,
    referenceName: "System.IterationPath",
    name: "Iteration Path",
  },
  {
    alwaysRequired: true,
    defaultValue: "New",
    referenceName: "System.State",
    name: "State",
    allowedValues: ["New", "Active", "Resolved", "Closed"],
  },
  {
    alwaysRequired: false,
    defaultValue: null,
    referenceName: "System.AssignedTo",
    name: "Assigned To",
  },
];

const accountFields = [
  {
    referenceName: "System.IterationPath",
    name: "Iteration Path",
    type: "treePath",
  },
  { referenceName: "System.State", name: "State", type: "string" },
  {
    referenceName: "System.AssignedTo",
    name: "Assigned To",
    type: "string",
    isIdentity: true,
  },
  { referenceName: "System.Id", name: "ID", type: "integer", readOnly: true },
];

const byRef = (fields: any[], ref: string) =>
  fields.find((f) => f.reference_name === ref)!;

describe("ADO field projection", () => {
  it("carries required, allowed values and defaults from the per-type endpoint", () => {
    const state = byRef(
      projectFields(typeFields, accountFields),
      "System.State",
    );
    expect(state).toMatchObject({
      name: "State",
      required: true,
      default_value: "New",
      allowed_values: ["New", "Active", "Resolved", "Closed"],
    });
  });

  /**
   * The per-type endpoint carries no data type at all — the join with the
   * account-wide list is the only way a widget can be chosen.
   */
  it("takes type, readOnly and isIdentity from the account-wide list", () => {
    const fields = projectFields(typeFields, accountFields);
    expect(byRef(fields, "System.IterationPath").type).toBe("treePath");
    expect(byRef(fields, "System.AssignedTo")).toMatchObject({
      type: "string",
      is_identity: true,
    });
  });

  it("degrades rather than fails when the account-wide list is unavailable", () => {
    const fields = projectFields(typeFields, []);
    expect(byRef(fields, "System.State").required).toBe(true);
    expect(byRef(fields, "System.State").type).toBeUndefined();
    expect(byRef(fields, "System.AssignedTo").is_identity).toBeUndefined();
  });

  it("keeps help text, which becomes the field's hint", () => {
    expect(
      byRef(projectFields(typeFields, accountFields), "System.IterationPath")
        .help_text,
    ).toContain("iteration");
  });

  it("caps allowed values and says when it did", () => {
    const many = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const [f] = projectFields(
      [{ referenceName: "X", name: "X", allowedValues: many }],
      [],
    );
    expect(f.allowed_values).toHaveLength(MAX_ALLOWED_VALUES);
    expect(f.allowed_values_truncated).toBe(true);
  });

  it("omits the truncation flag when nothing was dropped", () => {
    const [f] = projectFields(
      [{ referenceName: "X", name: "X", allowedValues: ["a", "b"] }],
      [],
    );
    expect(f.allowed_values_truncated).toBeUndefined();
  });

  it("ignores an account-wide field the type does not use", () => {
    const fields = projectFields(typeFields, accountFields);
    expect(fields.map((f) => f.reference_name)).not.toContain("System.Id");
  });
});

describe("workItemSchema", () => {
  const client = (over: Record<string, any> = {}) =>
    ({
      getTypeFields: async () => typeFields,
      listFields: async () => accountFields,
      ...over,
    }) as any;

  it("joins both endpoints and carries the config defaults through", async () => {
    const schema = await workItemSchema(client(), "ProjA", "Bug", {
      "System.AreaPath": "ProjA\\Portal",
    });
    expect(schema.project).toBe("ProjA");
    expect(schema.type).toBe("Bug");
    expect(schema.config_defaults).toEqual({
      "System.AreaPath": "ProjA\\Portal",
    });
    expect(byRef(schema.fields, "System.AssignedTo").is_identity).toBe(true);
  });

  /** Required fields still arrive; only the typed widgets are lost. */
  it("survives the account-wide list failing", async () => {
    const schema = await workItemSchema(
      client({
        listFields: async () => {
          throw new Error("403 — PAT lacks the scope");
        },
      }),
      "ProjA",
      "Bug",
    );
    expect(byRef(schema.fields, "System.State").required).toBe(true);
    expect(byRef(schema.fields, "System.State").type).toBeUndefined();
  });

  it("fails when the per-type call fails — there is no schema without it", async () => {
    await expect(
      workItemSchema(
        client({
          getTypeFields: async () => {
            throw new Error("404 — unknown type");
          },
        }),
        "ProjA",
        "Nope",
      ),
    ).rejects.toThrow(/unknown type/);
  });
});
