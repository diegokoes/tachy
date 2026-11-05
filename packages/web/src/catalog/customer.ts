/** What the customer page shows and offers, worked out from the rows the API returns. */
import type {
  CustomerChange,
  CustomerChangeBatch,
  CustomerRights,
  CustomerRow,
  CustomerUnitRow,
  ProductBlueprint,
  ProductRow,
} from "@tachy/contract";

/** One row of a setup tree: the unit and how deep it sits. */
export interface TreeRow {
  unit: CustomerUnitRow;
  depth: number;
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
    const walk = (parentId: string | null, depth: number) => {
      for (const unit of members
        .filter((u) =>
          parentId === null
            ? !u.parent_id || !ids.has(u.parent_id)
            : u.parent_id === parentId,
        )
        .sort((a, b) => a.slug.localeCompare(b.slug))) {
        rows.push({ unit, depth });
        walk(unit.id, depth + 1);
      }
    };
    walk(null, 0);
    return { product, rows };
  });
  return groups.filter((group) => group.rows.length);
}

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
  if (change.record === "unit") return `${verb} unit ${row.slug}`;
  if (change.record === "fact") {
    const label = row.label ? ` (${row.label})` : "";
    return `${verb === "changed" ? "set" : verb} fact ${row.kind}${label}`;
  }
  return `${verb} ${noun}`;
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
