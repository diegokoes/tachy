import { api } from "../api";
import { createResource } from "../resource.svelte";
import type { Census } from "./rows";

const EMPTY: Census = {
  counts: {},
  warn: {},
  detail: {
    sources: {
      connections: 0,
      projects: 0,
      knowledge: 0,
      trackers: 0,
      projects_no_wiki: 0,
      projects_for_customer: 0,
      by_type: {},
      untokened: 0,
      never_synced: 0,
    },
    repos: {
      repos: 0,
      failing: 0,
      ready: 0,
      working: 0,
      idle: 0,
      no_component: 0,
      no_project: 0,
      never_indexed: 0,
      files: 0,
      chunks: 0,
      oldest_indexed_at: null,
    },
    catalog: {
      teams: 0,
      products: 0,
      components: 0,
      labels: 0,
      patterns: 0,
      customers: 0,
      teams_no_product: 0,
      products_no_component: 0,
      components_root: 0,
      components_no_description: 0,
      labels_no_description: 0,
      patterns_no_description: 0,
      customers_no_domains: 0,
      customer_units: 0,
      components_by_product: [],
    },
    users: {
      users: 0,
      disabled: 0,
      admins: 0,
      team_admins: 0,
      with_password: 0,
      teams_with_admin: 0,
      teams_without_admin: [],
      users_no_team: 0,
    },
    knowledge: {
      entries: 0,
      entries_no_component: 0,
      entries_no_product: 0,
      by_status: {},
    },
  },
};

/**
 * One census for the whole admin area. A module singleton rather than a
 * resource inside AdminView: the rail's counts and all three overview panels
 * read the same numbers, and they are siblings on the page rather than a
 * parent and its one child, so there is nothing to pass it down through.
 *
 * Every block is laid over EMPTY rather than taken as it arrives. The SPA is
 * built separately from the server it talks to, so a browser holding a newer
 * bundle than the API asks for figures that response has never heard of — and
 * one `undefined` reaching a `.toLocaleString()` takes down the whole panel,
 * not just the number that is missing.
 */
export const census = createResource(async () => {
  const got = await api.get<Census>("/overview");
  const detail = Object.fromEntries(
    Object.entries(EMPTY.detail).map(([key, base]) => [
      key,
      { ...base, ...(got.detail?.[key as keyof Census["detail"]] ?? {}) },
    ]),
  ) as Census["detail"];
  return { counts: got.counts ?? {}, warn: got.warn ?? {}, detail };
}, EMPTY);
