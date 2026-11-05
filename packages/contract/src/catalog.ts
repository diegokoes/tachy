import type { LibraryActor } from "./vocabulary";

export interface CatalogCensus {
  teams: number;
  products: number;
  components: number;
  labels: number;
  patterns: number;
  customers: number;
  teams_no_product: number;
  products_no_component: number;
  components_root: number;
  components_no_description: number;
  labels_no_description: number;
  patterns_no_description: number;
  customers_no_domains: number;
  customer_units: number;
  components_by_product: { slug: string; name: string; n: number }[];
}

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  team_slug: string;
  team_name: string;
}

export interface ComponentRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  aliases: string[] | null;
}

/**
 * A component with the branch it hangs off, for drawing the whole catalogue
 * at once. `parent_id` is only ever another component of the same product, so
 * team → product → component → subcomponent is a tree, never a graph.
 */
export interface ComponentNode extends ComponentRow {
  product_slug: string;
  product_name: string;
  team_slug: string;
  team_name: string;
}

export interface LabelRow {
  id: string;
  slug: string;
  description: string | null;
}

export interface PatternRow {
  slug: string;
  description: string;
}

export interface CustomerRow {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  email_domains: string[] | null;
  notes: string | null;
  /** Slugs of the products the customer uses. */
  products: string[];
}

export interface CustomerUnitRow {
  id: string;
  customer_id: string;
  /** Null for a general unit, outside any product's blueprint. */
  product_id: string | null;
  product_slug: string | null;
  parent_id: string | null;
  template_id: string | null;
  kind: string;
  slug: string;
  name: string;
  aliases: string[];
  notes: string | null;
}

export interface UnitKindFactRow {
  kind: string;
  description: string | null;
  /** Every value the fact may take; empty for any value. */
  choices: string[];
  position: number;
}

export interface UnitKindRow {
  slug: string;
  name: string;
  description: string | null;
  /** The kind this one sits inside, by slug; null when it sits at the top. */
  parent_kind: string | null;
  /** The kind of template its units may follow, by slug. */
  template_kind: string | null;
  position: number;
  facts: UnitKindFactRow[];
}

/** A product's blueprint. No kinds: the product has none, and its units are free form. */
export interface ProductBlueprint {
  product_slug: string;
  kinds: UnitKindRow[];
}

export interface ResolvedFact {
  kind: string;
  label: string;
  value: string;
  notes: string | null;
  source: string | null;
  /** Null when the fact is true of the whole customer rather than a unit. */
  origin_slug: string | null;
  origin_name: string | null;
  origin_kind: string | null;
  /** True when it came from somewhere above, not from the unit itself. */
  inherited: boolean;
  /** The library doc that details the fact. */
  doc_id: string | null;
  doc_title: string | null;
}

export interface CustomerFactRow {
  id: string;
  /** Null for a fact true of the whole customer. */
  unit_id: string | null;
  unit_slug: string | null;
  kind: string;
  label: string;
  value: string;
  notes: string | null;
  source: string | null;
  component_id: string | null;
  component_slug: string | null;
  doc_id: string | null;
  doc_title: string | null;
  updated_at: string;
}

export interface CustomerComponentRow {
  id: string;
  slug: string;
  name: string;
  product_id: string;
  product_slug: string;
  notes: string | null;
}

export interface CustomerProfile {
  id: string;
  slug: string;
  name: string;
  notes: string | null;
  products: string[];
  /** Present when the profile was read for one unit. */
  unit?: { slug: string; name: string; kind: string; product: string | null };
  facts: {
    kind: string;
    label: string;
    value: string;
    component: string | null;
    /** Unit-resolved reads only: which level the fact came from. */
    origin?: string | null;
    origin_kind?: string | null;
    inherited?: boolean;
    /** The library doc that details the fact. */
    doc?: { id: string; title: string } | null;
  }[];
  units: {
    slug: string;
    name: string;
    kind: string;
    product: string | null;
    parent: string | null;
    template: string | null;
  }[];
  components: { slug: string; product_slug: string }[];
  repos: { slug: string; component: string | null; index_status: string }[];
  projects: { source_slug: string; external_key: string }[];
  /** Units and facts that disagree with their products' blueprints. */
  conflicts: { unit: string; problem: string }[];
  /** Customer reads: how many live entries and docs are filed under the customer. */
  library?: { entries: number; docs: number };
  /** Unit reads: fact kinds its blueprint asks for that nothing records, inherited ones included. */
  missing?: string[];
  /** Unit reads: docs filed under the unit, a unit it sits inside, or its template. */
  documents?: { id: string; title: string; unit: string; original: boolean }[];
  /** Unit reads: entries filed under the unit or a unit inside it. */
  entries?: { id: string; title: string; unit: string; status: string }[];
}

/** What a customer_changes row is about. */
export const CUSTOMER_CHANGE_RECORDS = [
  "customer",
  "product",
  "unit",
  "fact",
  "component",
] as const;
export type CustomerChangeRecord = (typeof CUSTOMER_CHANGE_RECORDS)[number];

export interface CustomerChange {
  record: CustomerChangeRecord;
  /** The row's id; for a product or component link, the product's or component's. */
  record_id: string;
  /** Null when the change added the record. */
  before: Record<string, unknown> | null;
  /** Null when the change deleted it. */
  after: Record<string, unknown> | null;
}

/** One action on a customer's record, as history lists it. */
export interface CustomerChangeBatch {
  batch_id: string;
  at: string;
  actor: LibraryActor;
  user_email: string | null;
  user_name: string | null;
  /** The batch this one undid. */
  restores: string | null;
  changes: CustomerChange[];
}

/** A deleted customer, and the batch whose restore brings it back. */
export interface DeletedCustomer {
  batch_id: string;
  at: string;
  slug: string;
  name: string;
  user_email: string | null;
  user_name: string | null;
}

/** What a search over customer data turns up, in three groups. */
export interface CustomerSearchHits {
  customers: { slug: string; name: string }[];
  units: {
    customer: string;
    slug: string;
    name: string;
    kind: string;
    product: string | null;
  }[];
  facts: {
    customer: string;
    unit: string | null;
    kind: string;
    label: string;
    value: string;
  }[];
}

/** What the caller may edit of one customer: its own record, and which products' parts. */
export interface CustomerRights {
  customer: boolean;
  /** Slugs of the products whose units and facts the caller may edit, linked to the customer or not. */
  products: string[];
}
