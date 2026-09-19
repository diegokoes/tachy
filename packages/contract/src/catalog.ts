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
}

export interface CustomerUnitRow {
  id: string;
  customer_id: string;
  parent_id: string | null;
  profile_id: string | null;
  kind: string;
  slug: string;
  name: string;
  aliases: string[];
  notes: string | null;
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
}

export interface CustomerFactRow {
  id: string;
  kind: string;
  label: string;
  value: string;
  notes: string | null;
  source: string | null;
  component_id: string | null;
  component_slug: string | null;
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
  /** Present when the profile was read for one unit. */
  unit?: { slug: string; name: string; kind: string };
  facts: {
    kind: string;
    label: string;
    value: string;
    component: string | null;
    /** Unit-resolved reads only: which level the fact came from. */
    origin?: string | null;
    origin_kind?: string | null;
    inherited?: boolean;
  }[];
  units: {
    slug: string;
    name: string;
    kind: string;
    parent: string | null;
    profile: string | null;
  }[];
  components: { slug: string; product_slug: string }[];
  repos: { slug: string; component: string | null; index_status: string }[];
  projects: { source_slug: string; external_key: string }[];
}
