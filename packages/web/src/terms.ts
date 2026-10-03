import { session } from "./session.svelte";

import type { DeploymentProfile } from "@tachy/contract";

/** The contract's list, under the name this module has always used for it. */
export type Profile = DeploymentProfile;

type TermKey =
  | "product"
  | "products"
  | "team"
  | "teams"
  | "cloud"
  | "customer"
  | "customers";

const MAP: Record<Profile, Record<TermKey, string>> = {
  support: {
    product: "product",
    products: "products",
    team: "team",
    teams: "teams",
    cloud: "environment",
    customer: "customer",
    customers: "customers",
  },
  engineering: {
    product: "repository",
    products: "repositories",
    team: "organization",
    teams: "organizations",
    cloud: "environment",
    customer: "customer",
    customers: "customers",
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

/**
 * The stored role word is the same on both rungs, so neither is ever shown on
 * its own: an app admin manages users, org structure and system settings; a
 * team admin curates one team's library and roster, under whatever that
 * deployment calls a team.
 */
export function roleLabel(rung: "app" | "team", role: string): string {
  if (role !== "admin") return "member";
  return rung === "app" ? "app admin" : `${t("team")} admin`;
}

export function roleTip(rung: "app" | "team"): string {
  return rung === "app"
    ? "app admin: users, org structure, system settings. member: app access; curation via team role."
    : `${t("team")} admin: this ${t("team")}'s knowledge, docs, taxonomy, members. member: app access.`;
}
