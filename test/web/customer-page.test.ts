import { describe, expect, it } from "vitest";
import type {
  CustomerChangeBatch,
  CustomerRow,
  CustomerUnitRow,
  ProductBlueprint,
  ProductRow,
} from "@tachy/contract";
import {
  batchAuthor,
  batchText,
  canEditPart,
  customersInScope,
  factChoices,
  factKindChoices,
  productsOfTeams,
  setupGroups,
  unitKindChoices,
} from "../../packages/web/src/catalog/customer";

const unit = (
  slug: string,
  over: Partial<CustomerUnitRow> = {},
): CustomerUnitRow => ({
  id: slug,
  customer_id: "c",
  product_id: null,
  product_slug: null,
  parent_id: null,
  template_id: null,
  kind: "line",
  slug,
  name: slug.toUpperCase(),
  aliases: [],
  notes: null,
  ...over,
});

const BLUEPRINT: ProductBlueprint = {
  product_slug: "tpd",
  kinds: [
    {
      slug: "layout",
      name: "Layout",
      description: null,
      parent_kind: null,
      template_kind: null,
      position: 0,
      facts: [
        { kind: "printers", description: null, choices: [], position: 0 },
      ],
    },
    {
      slug: "line",
      name: "Line",
      description: null,
      parent_kind: "site",
      template_kind: "layout",
      position: 1,
      facts: [
        {
          kind: "coding_mode",
          description: null,
          choices: ["CT1", "CT2"],
          position: 0,
        },
      ],
    },
  ],
};

describe("the setup tree", () => {
  it("groups units by product, general last, each depth-first", () => {
    const groups = setupGroups([
      unit("tlc192", { product_slug: "tpd", parent_id: "cantabria" }),
      unit("cantabria", { product_slug: "tpd", kind: "site" }),
      unit("tlc191", { product_slug: "tpd", parent_id: "cantabria" }),
      unit("sap", { kind: "integration" }),
    ]);
    expect(
      groups.map((g) => [
        g.product,
        g.rows.map((r) => `${r.depth}:${r.unit.slug}`),
      ]),
    ).toEqual([
      ["tpd", ["0:cantabria", "1:tlc191", "1:tlc192"]],
      [null, ["0:sap"]],
    ]);
  });

  it("starts a tree at a unit whose parent is in another group", () => {
    const [general] = setupGroups([unit("line", { parent_id: "elsewhere" })]);
    expect(general.rows).toEqual([{ unit: expect.anything(), depth: 0 }]);
  });
});

describe("what the page offers", () => {
  it("lets the caller edit a product's part only with that product's rights", () => {
    const rights = { customer: false, products: ["tpd"] };
    expect(canEditPart(rights, "tpd")).toBe(true);
    expect(canEditPart(rights, "ftrace")).toBe(false);
    expect(canEditPart(rights, null)).toBe(false);
    expect(canEditPart(null, "tpd")).toBe(false);
  });

  it("offers the blueprint's kinds, or the kinds in use where there is none", () => {
    expect(unitKindChoices(BLUEPRINT, ["hall"])).toEqual({
      kinds: ["layout", "line"],
      free: false,
    });
    expect(unitKindChoices(undefined, ["site", "line", "site"])).toEqual({
      kinds: ["line", "site"],
      free: true,
    });
  });

  it("offers a template the facts of the kinds that follow it, with their choices", () => {
    expect(factKindChoices(BLUEPRINT, "layout", [])).toEqual({
      kinds: ["printers", "coding_mode"],
      free: false,
    });
    expect(factKindChoices(BLUEPRINT, "hall", ["ip"])).toEqual({
      kinds: ["ip"],
      free: true,
    });
    expect(factChoices(BLUEPRINT, "layout", "coding_mode")).toEqual([
      "CT1",
      "CT2",
    ]);
    expect(factChoices(BLUEPRINT, "line", "printers")).toEqual([]);
    expect(factChoices(undefined, "line", "coding_mode")).toEqual([]);
  });
});

describe("the customer list's scope", () => {
  const customer = (slug: string, products: string[]): CustomerRow => ({
    id: slug,
    slug,
    name: slug,
    aliases: [],
    email_domains: [],
    notes: null,
    products,
  });
  const customers = [
    customer("itg", ["tpd"]),
    customer("logista", ["ftrace"]),
    customer("new", []),
  ];

  it("opens on the caller's products and the unclaimed, and widens to everything", () => {
    expect(
      customersInScope(customers, ["tpd"], false).map((c) => c.slug),
    ).toEqual(["itg", "new"]);
    expect(customersInScope(customers, ["tpd"], true)).toHaveLength(3);
    expect(customersInScope(customers, [], false)).toHaveLength(3);
  });

  it("finds the caller's products through their teams", () => {
    const products = [
      { slug: "tpd", team_slug: "trace" },
      { slug: "ftrace", team_slug: "fleet" },
    ] as ProductRow[];
    expect(productsOfTeams(products, ["trace"])).toEqual(["tpd"]);
  });
});

describe("history lines", () => {
  const batch = (over: Partial<CustomerChangeBatch>): CustomerChangeBatch => ({
    batch_id: "b",
    at: "2026-11-05T00:00:00Z",
    actor: "web",
    user_email: "lead@example.com",
    user_name: null,
    restores: null,
    changes: [],
    ...over,
  });

  it("says what a batch did and how much came with it", () => {
    expect(
      batchText(
        batch({
          changes: [
            {
              record: "unit",
              record_id: "u",
              before: { slug: "tlc191" },
              after: null,
            },
            {
              record: "fact",
              record_id: "f",
              before: { kind: "ip", label: "plc" },
              after: null,
            },
          ],
        }),
      ),
    ).toBe("removed unit tlc191 and 1 more");
    expect(
      batchText(
        batch({
          restores: "x",
          changes: [
            {
              record: "fact",
              record_id: "f",
              before: { kind: "ip", label: "plc" },
              after: { kind: "ip", label: "plc" },
            },
          ],
        }),
      ),
    ).toBe("restored set fact ip (plc)");
    expect(
      batchText(
        batch({
          changes: [
            {
              record: "product",
              record_id: "p",
              before: null,
              after: { product_id: "p" },
            },
          ],
        }),
      ),
    ).toBe("added a product link");
  });

  it("names who made it, and the agent when it acted for them", () => {
    expect(batchAuthor(batch({}))).toBe("lead@example.com");
    expect(batchAuthor(batch({ actor: "agent", user_name: "Lead" }))).toBe(
      "Lead via the agent",
    );
  });
});
