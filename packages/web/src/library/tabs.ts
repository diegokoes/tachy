import type { SubnavItem } from "../shell/subnav.svelte";
import { wikiPath } from "../wiki/paths";

export type LibraryTab = "all" | "wiki" | "gaps" | "customers";

/** The library's tabs, shared with the wiki: everything, one wiki, its gaps. */
export const LIBRARY_TABS: SubnavItem[] = [
  { key: "all", label: "all", icon: "library" },
  { key: "wiki", label: "wiki", icon: "wiki" },
  { key: "gaps", label: "gaps", icon: "gaps" },
];

const CUSTOMERS_TAB: SubnavItem = {
  key: "customers",
  label: "customers",
  icon: "customer",
};

/** The tabs a view shows; the customer pages exist only where customers do. */
export const libraryTabs = (opts: { customers: boolean }): SubnavItem[] =>
  opts.customers ? [...LIBRARY_TABS, CUSTOMERS_TAB] : LIBRARY_TABS;

/** The tab a path is under: a wiki's gaps page, any other wiki page, a customer page, or the rest. */
export function libraryTab(path: string): LibraryTab {
  const [section, , page] = path.split("/").filter(Boolean);
  if (section === "customers") return "customers";
  if (section !== "wiki") return "all";
  return page === "gaps" ? "gaps" : "wiki";
}

/** Where a tab goes; the two wiki tabs go to `scope`'s wiki. */
export function libraryTabPath(tab: string, scope: string): string {
  if (tab === "wiki") return wikiPath(scope);
  if (tab === "customers") return "/customers";
  return tab === "gaps" ? wikiPath(scope, "gaps") : "/library";
}
