/** What the customer page shows and offers, worked out from the rows the API returns. */
import type {
  CustomerChange,
  CustomerChangeBatch,
  CustomerFactRow,
  CustomerRights,
  CustomerRow,
  CustomerUnitRow,
  ProductBlueprint,
  ProductRow,
} from "@tachy/contract";

/**
 * One cell of the lines that join a tree row to its parent and siblings, as
 * `tree` draws them: a line passing on (│), a branch (├─), the last branch
 * (└─), or nothing.
 */
export type TreeGuide = "pipe" | "tee" | "elbow" | "blank";

/** One row of a setup tree: the unit, how deep it sits, and its guides, outermost first. */
export interface TreeRow {
  unit: CustomerUnitRow;
  depth: number;
  guides: TreeGuide[];
}

/** One product's setup, or the general units (`product` null), as a tree. */
export interface SetupGroup {
  product: string | null;
  rows: TreeRow[];
}

/**
 * Each product's units depth-first, then the general ones. A unit whose parent
 * sits in another group starts a tree of its own here.
 */
export function setupGroups(units: CustomerUnitRow[]): SetupGroup[] {
  const products = [
    ...new Set(units.flatMap((u) => (u.product_slug ? [u.product_slug] : []))),
  ].sort();
  const groups = [...products, null].map((product) => {
    const members = units.filter((u) => u.product_slug === product);
    const ids = new Set(members.map((u) => u.id));
    const rows: TreeRow[] = [];
    const walk = (
      parentId: string | null,
      depth: number,
      lead: TreeGuide[],
    ) => {
      const children = members
        .filter((u) =>
          parentId === null
            ? !u.parent_id || !ids.has(u.parent_id)
            : u.parent_id === parentId,
        )
        .sort((a, b) => a.slug.localeCompare(b.slug));
      children.forEach((unit, index) => {
        const last = index === children.length - 1;
        rows.push({ unit, depth, guides: [...lead, last ? "elbow" : "tee"] });
        walk(unit.id, depth + 1, [...lead, last ? "blank" : "pipe"]);
      });
    };
    walk(null, 0, []);
    return { product, rows };
  });
  return groups.filter((group) => group.rows.length);
}

/** The units `unit` sits inside, outermost first. */
export function unitAncestors(
  units: CustomerUnitRow[],
  unit: CustomerUnitRow,
): CustomerUnitRow[] {
  const ancestors: CustomerUnitRow[] = [];
  let parent = units.find((u) => u.id === unit.parent_id);
  while (parent && !ancestors.includes(parent)) {
    ancestors.unshift(parent);
    const above = parent.parent_id;
    parent = units.find((u) => u.id === above);
  }
  return ancestors;
}

/** `unit` and every unit inside it, at any depth. */
function withDescendants(
  units: CustomerUnitRow[],
  unit: CustomerUnitRow,
): Set<string> {
  const ids = new Set([unit.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const u of units)
      if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) {
        ids.add(u.id);
        grew = true;
      }
  }
  return ids;
}

/** What decides where a unit of `kind` may go: the customer's units, its product and that product's blueprint. */
export interface Placement {
  units: CustomerUnitRow[];
  blueprint: ProductBlueprint | undefined;
  product: string | null;
  kind: string;
  /** The unit being edited, which can sit neither inside nor follow itself. */
  editing?: CustomerUnitRow | null;
}

/** The product's units a unit may be placed against, minus the one being edited and what is inside it. */
function candidates({ units, product, editing }: Placement) {
  const own = editing ? withDescendants(units, editing) : new Set<string>();
  return units.filter(
    (u) => (u.product_slug ?? null) === product && !own.has(u.id),
  );
}

/**
 * The units a unit of `kind` may sit inside: those of its blueprint's parent
 * kind, none when the blueprint keeps it at the top, any of the product's
 * when no blueprint governs it.
 */
export function parentChoices(placement: Placement): CustomerUnitRow[] {
  const kind = placement.blueprint?.kinds.find(
    (k) => k.slug === placement.kind,
  );
  if (!placement.blueprint?.kinds.length) return candidates(placement);
  if (!kind?.parent_kind) return [];
  return candidates(placement).filter((u) => u.kind === kind.parent_kind);
}

/** The units a unit of `kind` may follow: those of its blueprint's template kind, or any of the product's with no blueprint. */
export function templateChoices(placement: Placement): CustomerUnitRow[] {
  const kind = placement.blueprint?.kinds.find(
    (k) => k.slug === placement.kind,
  );
  if (!placement.blueprint?.kinds.length) return candidates(placement);
  if (!kind?.template_kind) return [];
  return candidates(placement).filter((u) => u.kind === kind.template_kind);
}

/** The kind a unit added inside one of `parentKind` takes first: the first the blueprint nests there. */
export const childKind = (
  blueprint: ProductBlueprint | undefined,
  parentKind: string,
): string | null =>
  blueprint?.kinds.find((k) => k.parent_kind === parentKind)?.slug ?? null;

/** Whether the caller may edit a part of the customer tied to `product`, or its own record. */
export const canEditPart = (
  rights: CustomerRights | null,
  product: string | null,
) =>
  !!rights && (product ? rights.products.includes(product) : rights.customer);

/** The kinds a new unit may take: the blueprint's when it has some, otherwise those in use. */
export function unitKindChoices(
  blueprint: ProductBlueprint | undefined,
  inUse: string[],
): { kinds: string[]; free: boolean } {
  const listed = blueprint?.kinds.map((kind) => kind.slug) ?? [];
  if (listed.length) return { kinds: listed, free: false };
  return { kinds: [...new Set(inUse)].sort(), free: true };
}

/**
 * The facts a unit of `unitKind` may record under its blueprint: its own, and
 * on a template, those of the kinds that follow it. Free when no blueprint
 * governs it, offering the kinds in use.
 */
export function factKindChoices(
  blueprint: ProductBlueprint | undefined,
  unitKind: string | null,
  inUse: string[],
): { kinds: string[]; free: boolean } {
  const kind = blueprint?.kinds.find((k) => k.slug === unitKind);
  if (!blueprint?.kinds.length || !kind)
    return { kinds: [...new Set(inUse)].sort(), free: true };
  const followers = blueprint.kinds.filter(
    (k) => k.template_kind === kind.slug,
  );
  const kinds = [kind, ...followers].flatMap((k) => k.facts.map((f) => f.kind));
  return { kinds: [...new Set(kinds)], free: false };
}

/** The values a fact may take, or none when it takes any. */
export function factChoices(
  blueprint: ProductBlueprint | undefined,
  unitKind: string | null,
  factKind: string,
): string[] {
  const kind = blueprint?.kinds.find((k) => k.slug === unitKind);
  if (!blueprint || !kind) return [];
  const governing = [
    kind,
    ...blueprint.kinds.filter((k) => k.template_kind === kind.slug),
  ];
  for (const candidate of governing) {
    const fact = candidate.facts.find((f) => f.kind === factKind);
    if (fact) return fact.choices;
  }
  return [];
}

/**
 * The customers a list opens on: those using one of the caller's products,
 * and those no product claims yet. `everything` lists them all, as does a
 * caller with no product of their own.
 */
export function customersInScope(
  customers: CustomerRow[],
  myProducts: string[],
  everything: boolean,
): CustomerRow[] {
  if (everything || !myProducts.length) return customers;
  return customers.filter(
    (customer) =>
      !customer.products.length ||
      customer.products.some((product) => myProducts.includes(product)),
  );
}

/** The products of the teams the caller belongs to. */
export const productsOfTeams = (
  products: ProductRow[],
  teamSlugs: string[],
): string[] =>
  products.filter((p) => teamSlugs.includes(p.team_slug)).map((p) => p.slug);

const RECORD_NOUN: Record<CustomerChange["record"], string> = {
  customer: "the customer",
  product: "a product link",
  unit: "unit",
  fact: "fact",
  component: "a component link",
};

function changeVerb(change: CustomerChange): string {
  if (!change.before) return "added";
  if (!change.after) return "removed";
  return "changed";
}

/** What one change did, in a line: "set fact ip (plc)". */
export function changeText(change: CustomerChange): string {
  const row = (change.after ?? change.before)!;
  const verb = changeVerb(change);
  const noun = RECORD_NOUN[change.record];
  if (change.record === "unit") return `${verb} unit ${row.name ?? row.slug}`;
  if (change.record === "fact") {
    const label = row.label ? ` (${row.label})` : "";
    return `${verb === "changed" ? "set" : verb} fact ${row.kind}${label}`;
  }
  return `${verb} ${noun}`;
}

/**
 * Columns a snapshot keeps that tell a reader nothing: keys, bookkeeping, and
 * the slug, which never changes and which the change's own line names.
 */
const UNSHOWN_COLUMNS = new Set([
  "id",
  "slug",
  "customer_id",
  "created_at",
  "updated_at",
  "profile_id",
]);

/** The order fields read in, what a record is before where it sits; the rest follow. */
const COLUMN_ORDER = [
  "name",
  "kind",
  "label",
  "value",
  "product_id",
  "parent_id",
  "template_id",
  "unit_id",
  "component_id",
  "doc_id",
];

/** Column names that read differently on the page. */
const COLUMN_WORDS: Record<string, string> = {
  product_id: "product",
  parent_id: "inside",
  template_id: "template",
  unit_id: "unit",
  component_id: "component",
  doc_id: "doc",
  email_domains: "email domains",
};

const columnRank = (column: string) => {
  const rank = COLUMN_ORDER.indexOf(column);
  return rank < 0 ? COLUMN_ORDER.length : rank;
};

/** One field of a change: null on a side where it held nothing. */
export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/**
 * What a change did, field by field: every field an added or removed record
 * holds, and the ones a changed record changed. `nameOf` gives an id column's
 * value the name it is shown by.
 */
export function fieldChanges(
  change: CustomerChange,
  nameOf: (column: string, id: string) => string,
): FieldChange[] {
  const shown = (row: Record<string, unknown> | null, column: string) => {
    const value = row?.[column];
    if (Array.isArray(value)) return value.length ? value.join(", ") : null;
    if (value === null || value === undefined || value === "") return null;
    if (column.endsWith("_id")) return nameOf(column, String(value));
    return String(value);
  };
  const columns = new Set([
    ...Object.keys(change.before ?? {}),
    ...Object.keys(change.after ?? {}),
  ]);
  return [...columns]
    .filter((column) => !UNSHOWN_COLUMNS.has(column))
    .sort((a, b) => columnRank(a) - columnRank(b))
    .map((column) => ({
      field: COLUMN_WORDS[column] ?? column,
      before: shown(change.before, column),
      after: shown(change.after, column),
    }))
    .filter((field) => field.before !== field.after);
}

/**
 * The names history shows for the ids its snapshots hold, from what the page
 * has loaded; a record gone since is named by what it was.
 */
export function historyNames(known: {
  products: ProductRow[];
  units: CustomerUnitRow[];
  facts: CustomerFactRow[];
}): (column: string, id: string) => string {
  return (column, id) => {
    if (column === "product_id")
      return known.products.find((p) => p.id === id)?.name ?? "a product";
    if (column === "doc_id")
      return known.facts.find((f) => f.doc_id === id)?.doc_title ?? "a doc";
    if (column === "component_id")
      return (
        known.facts.find((f) => f.component_id === id)?.component_slug ??
        "a component"
      );
    return known.units.find((u) => u.id === id)?.name ?? "a removed unit";
  };
}

/** A batch in a line: its first change, and how many more came with it. */
export function batchText(batch: CustomerChangeBatch): string {
  const [first, ...rest] = batch.changes;
  const lead = batch.restores ? "restored " : "";
  const more = rest.length ? ` and ${rest.length} more` : "";
  return `${lead}${changeText(first)}${more}`;
}

/** Who made a batch, and the agent when it acted for them. */
export function batchAuthor(batch: CustomerChangeBatch): string {
  const who = batch.user_name ?? batch.user_email ?? "someone";
  return batch.actor === "agent" ? `${who} via the agent` : who;
}
