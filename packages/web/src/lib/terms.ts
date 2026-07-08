// Deployment-profile terminology: display strings only. Slugs, API fields, and
// the MCP contract are identical under both profiles — an engineering instance
// just reads "repository" where a support instance reads "product".
import { session } from "./session.svelte";

export type Profile = "support" | "engineering";

type TermKey =
  | "product" | "products"
  | "team" | "teams"
  | "cloud"
  | "customer" | "customers";

const MAP: Record<Profile, Record<TermKey, string>> = {
  support: {
    product: "product", products: "products",
    team: "team", teams: "teams",
    cloud: "environment",
    customer: "customer", customers: "customers",
  },
  engineering: {
    product: "repository", products: "repositories",
    team: "organization", teams: "organizations",
    cloud: "environment",
    customer: "customer", customers: "customers",
  },
};

export function profile(): Profile {
  return (session.config?.profile as Profile) ?? "support";
}

export function t(key: TermKey): string {
  return MAP[profile()][key];
}

// Which optional facets each profile surfaces. Engineering hides the customer
// dimension — repos rarely have one; the data stays intact if it exists.
const PROFILE_FACETS: Record<Profile, { customer: boolean }> = {
  support: { customer: true },
  engineering: { customer: false },
};

export function showCustomer(): boolean {
  return PROFILE_FACETS[profile()].customer;
}
