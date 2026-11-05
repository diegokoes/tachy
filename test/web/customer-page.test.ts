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
  product_slug: "tqx",
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
      unit("pln192", { product_slug: "tqx", parent_id: "calderra" }),
      unit("calderra", { product_slug: "tqx", kind: "site" }),
      unit("pln191", { product_slug: "tqx", parent_id: "calderra" }),
      unit("sap", { kind: "integration" }),
    ]);
    expect(
      groups.map((g) => [
        g.product,
        g.rows.map((r) => `${r.depth}:${r.unit.slug}`),
      ]),
    ).toEqual([
      ["tqx", ["0:calderra", "1:pln191", "1:pln192"]],
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
    const rights = { customer: false, products: ["tqx"] };
    expect(canEditPart(rights, "tqx")).toBe(true);
    expect(canEditPart(rights, "fqlink")).toBe(false);
    expect(canEditPart(rights, null)).toBe(false);
    expect(canEditPart(null, "tqx")).toBe(false);
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
    customer("ivk", ["tqx"]),
    customer("losvane", ["fqlink"]),
    customer("new", []),
  ];

  it("opens on the caller's products and the unclaimed, and widens to everything", () => {
    expect(
      customersInScope(customers, ["tqx"], false).map((c) => c.slug),
    ).toEqual(["ivk", "new"]);
    expect(customersInScope(customers, ["tqx"], true)).toHaveLength(3);
    expect(customersInScope(customers, [], false)).toHaveLength(3);
  });

  it("finds the caller's products through their teams", () => {
    const products = [
      { slug: "tqx", team_slug: "trace" },
      { slug: "fqlink", team_slug: "fleet" },
    ] as ProductRow[];
    expect(productsOfTeams(products, ["trace"])).toEqual(["tqx"]);
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
              before: { slug: "pln191" },
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
    ).toBe("removed unit pln191 and 1 more");
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
