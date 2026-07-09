


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



const PROFILE_FACETS: Record<Profile, { customer: boolean }> = {
  support: { customer: true },
  engineering: { customer: false },
};

export function showCustomer(): boolean {
  return PROFILE_FACETS[profile()].customer;
}
