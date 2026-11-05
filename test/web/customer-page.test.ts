import { describe, expect, it } from "vitest";
import type {
  CustomerChangeBatch,
  CustomerFactRow,
  CustomerRow,
  CustomerUnitRow,
  ProductBlueprint,
  ProductRow,
} from "@tachy/contract";
import {
  batchAuthor,
  batchText,
  canEditPart,
  childKind,
  customersInScope,
  factChoices,
  factKindChoices,
  fieldChanges,
  historyNames,
  parentChoices,
  productsOfTeams,
  setupGroups,
  templateChoices,
  unitAncestors,
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
    expect(general.rows).toEqual([
      { unit: expect.anything(), depth: 0, guides: ["elbow"] },
    ]);
  });

  it("joins each row to its parent and siblings with box-drawing guides", () => {
    const [tqx] = setupGroups([
      unit("calderra", { product_slug: "tqx", kind: "site" }),
      unit("pln191", { product_slug: "tqx", parent_id: "calderra" }),
      unit("pln192", { product_slug: "tqx", parent_id: "calderra" }),
      unit("logrono", { product_slug: "tqx", kind: "site" }),
      unit("tpc146", { product_slug: "tqx", parent_id: "logrono" }),
    ]);
    const drawn = { pipe: "│  ", tee: "├─ ", elbow: "└─ ", blank: "   " };
    expect(
      tqx.rows.map((r) => r.guides.map((g) => drawn[g]).join("") + r.unit.slug),
    ).toEqual([
      "├─ calderra",
      "│  ├─ pln191",
      "│  └─ pln192",
      "└─ logrono",
      "   └─ tpc146",
    ]);
  });

  it("lists the units a unit sits inside, outermost first", () => {
    const units = [
      unit("plant", { kind: "site" }),
      unit("hall", { kind: "hall", parent_id: "plant" }),
      unit("line", { parent_id: "hall" }),
    ];
    expect(unitAncestors(units, units[2]).map((u) => u.slug)).toEqual([
      "plant",
      "hall",
    ]);
    expect(unitAncestors(units, units[0])).toEqual([]);
  });
});

describe("where a unit may go", () => {
  const SITES: ProductBlueprint = {
    product_slug: "tqx",
    kinds: [
      ...BLUEPRINT.kinds,
      {
        slug: "site",
        name: "Site",
        description: null,
        parent_kind: null,
        template_kind: null,
        position: 2,
        facts: [],
      },
    ],
  };
  const units = [
    unit("calderra", { product_slug: "tqx", kind: "site" }),
    unit("layout-3", { product_slug: "tqx", kind: "layout" }),
    unit("pln191", {
      product_slug: "tqx",
      parent_id: "calderra",
      template_id: "layout-3",
    }),
    unit("sap", { kind: "integration" }),
  ];
  const slugs = (rows: CustomerUnitRow[]) => rows.map((u) => u.slug);

  it("offers a line the sites to sit in and the layouts to follow", () => {
    const placement = {
      units,
      blueprint: SITES,
      product: "tqx",
      kind: "line",
    };
    expect(slugs(parentChoices(placement))).toEqual(["calderra"]);
    expect(slugs(templateChoices(placement))).toEqual(["layout-3"]);
  });

  it("keeps a kind the blueprint puts at the top level there", () => {
    const placement = { units, blueprint: SITES, product: "tqx", kind: "site" };
    expect(parentChoices(placement)).toEqual([]);
    expect(templateChoices(placement)).toEqual([]);
  });

  it("offers any of the product's units with no blueprint, never the unit itself or what is inside it", () => {
    const placement = {
      units,
      blueprint: undefined,
      product: "tqx",
      kind: "line",
      editing: units[0],
    };
    expect(slugs(parentChoices(placement))).toEqual(["layout-3"]);
    expect(slugs(templateChoices(placement))).toEqual(["layout-3"]);
  });

  it("starts a unit added inside another on the kind the blueprint nests there", () => {
    expect(childKind(SITES, "site")).toBe("line");
    expect(childKind(SITES, "line")).toBeNull();
    expect(childKind(undefined, "site")).toBeNull();
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
              before: { slug: "pln191", name: "PLN191" },
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
    ).toBe("removed unit PLN191 and 1 more");
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

describe("what a change did, field by field", () => {
  const names = historyNames({
    products: [{ id: "p1", slug: "tqx", name: "Trellis" } as ProductRow],
    units: [unit("calderra", { name: "Altavon / Calderra" })],
    facts: [
      { doc_id: "d1", doc_title: "Line manual" } as CustomerFactRow,
      { component_id: "c1", component_slug: "printer" } as CustomerFactRow,
    ],
  });

  it("shows only what a changed record changed, by the names on the page", () => {
    expect(
      fieldChanges(
        {
          record: "unit",
          record_id: "u",
          before: {
            id: "u",
            name: "PLN191",
            parent_id: null,
            aliases: [],
            updated_at: "a",
          },
          after: {
            id: "u",
            name: "PLN 191",
            parent_id: "calderra",
            aliases: [],
            updated_at: "b",
          },
        },
        names,
      ),
    ).toEqual([
      { field: "name", before: "PLN191", after: "PLN 191" },
      { field: "inside", before: null, after: "Altavon / Calderra" },
    ]);
  });

  it("shows everything an added or removed record held, and names what is gone", () => {
    expect(
      fieldChanges(
        {
          record: "fact",
          record_id: "f",
          before: null,
          after: {
            kind: "ip",
            label: "",
            value: "10.0.0.5",
            doc_id: "d1",
            unit_id: "gone",
          },
        },
        names,
      ),
    ).toEqual([
      { field: "kind", before: null, after: "ip" },
      { field: "value", before: null, after: "10.0.0.5" },
      { field: "unit", before: null, after: "a removed unit" },
      { field: "doc", before: null, after: "Line manual" },
    ]);
    expect(
      fieldChanges(
        {
          record: "product",
          record_id: "p1",
          before: { product_id: "p1", notes: null },
          after: null,
        },
        names,
      ),
    ).toEqual([{ field: "product", before: "Trellis", after: null }]);
    const componentLink = (id: string) =>
      fieldChanges(
        {
          record: "component",
          record_id: id,
          before: null,
          after: { component_id: id },
        },
        names,
      );
    expect(componentLink("c1")).toEqual([
      { field: "component", before: null, after: "printer" },
    ]);
    expect(componentLink("c9")[0].after).toBe("a component");
  });
});
