/**
 * The console's map: its pages and the sections under each, as the router and
 * the command palette see them. AdminView puts a view to each key; anything
 * that only has to name, count or link to a section reads it here.
 */
import { isGlobalAdmin } from "../access/session.svelte";
import type { SubnavItem } from "../shell/subnav.svelte";
import { t, showCustomer } from "../terms";
import type { IconName } from "../tui/icons";

export type ConsolePage = SubnavItem & {
  /** False for a page with no overview of its own: it opens on its first section. */
  overview?: false;
};

export const CONSOLE_PAGES: ConsolePage[] = [
  { key: "integrations", label: "integrations", icon: "integrations" },
  { key: "structure", label: "structure", icon: "structure" },
  { key: "access", label: "users", icon: "users" },
  { key: "flows", label: "flows", icon: "flows", overview: false },
  { key: "workers", label: "jobs", icon: "workers" },
  { key: "system", label: "system", icon: "system" },
];

/** The `page` values the issues endpoint accepts. */
const ISSUE_PAGES = [
  "integrations",
  "structure",
  "access",
  "workers",
  "system",
];
const ADMIN_ISSUE_PAGES = ["workers", "system"];

export const hasIssueList = (page: string, { admin }: { admin: boolean }) =>
  ISSUE_PAGES.includes(page) && (admin || !ADMIN_ISSUE_PAGES.includes(page));

export type ConsoleSection = {
  key: string;
  label: string;
  icon?: IconName;
  /** Which census key counts this section. Omitted for a section with nothing to count. */
  n?: string;
  show?: boolean;
  /**
   * Where the section opens. A handful of rows belongs over the overview,
   * where the counters stay readable behind it; a list that runs to fifty
   * wants the window. Defaults to the window.
   */
  present?: "modal" | "page";
  /** A page section that takes the whole window, edge to edge, and never scrolls. */
  fill?: boolean;
  /** The add its panel offers on the section heading, by the panel's own label. */
  add?: string;
};

/** Every page's sections, in rail order. Reads the session and the terms, so derive from it rather than read it once. */
export function consoleSections(): Record<string, ConsoleSection[]> {
  const admin = isGlobalAdmin();
  return {
    flows: [{ key: "forms", label: "ticket forms", fill: true }],
    integrations: [
      { key: "sources", label: "sources", n: "sources", add: "add connection" },
      {
        key: "projects",
        label: "projects",
        icon: "project",
        n: "projects",
        add: "register project",
      },
      { key: "tickets", label: "stored tickets", n: "tickets" },
      {
        key: "repos",
        label: "repos",
        icon: "repo",
        n: "repos",
        add: "link repository",
      },
      {
        key: "buckets",
        label: "buckets",
        n: "buckets",
        present: "modal",
        add: "add bucket",
      },
      {
        key: "mcp-servers",
        label: "mcp servers",
        icon: "tool",
        n: "mcp_servers",
        add: "link server",
      },
      { key: "bulk-link", label: "bulk link", fill: true },
    ],
    structure: [
      { key: "teams", label: t("teams"), n: "teams", add: `add ${t("team")}` },
      {
        key: "products",
        label: t("products"),
        n: "products",
        add: `add ${t("product")}`,
      },
      { key: "components", label: "components", n: "components", fill: true },
      { key: "map", label: "entries per component", fill: true },
      { key: "labels", label: "labels", n: "labels", add: "add label" },
      {
        key: "patterns",
        label: "resolution patterns",
        n: "patterns",
        add: "add pattern",
      },
      {
        key: "customers",
        label: t("customers"),
        n: "customers",
        show: showCustomer(),
        add: `add ${t("customer")}`,
      },
    ],
    access: [
      {
        key: "users",
        label: "users",
        icon: "users",
        n: "users",
        add: "add user",
      },
      { key: "teams", label: `${t("team")} members`, n: "teams" },
      { key: "admins", label: "app admins" },
    ],
    workers: [
      { key: "jobs", label: "schedule", icon: "jobs", add: "add job" },
      { key: "runs", label: "runs", icon: "runs" },
      { key: "queues", label: "queues", icon: "queues" },
      { key: "processes", label: "workers", icon: "workerPool" },
      { key: "failures", label: "failed jobs", present: "modal" },
    ],
    // All dialogs: the overview carries the summary of each, which is the page,
    // and a counter or tile opens the full detail behind it.
    system: [
      { key: "reports", label: "reports", n: "reports", show: admin },
      { key: "audit", label: "audit trail", show: admin, present: "modal" },
      { key: "runtime", label: "runtime", present: "modal" },
      { key: "host", label: "backups & host", present: "modal" },
      { key: "checks", label: "checks", present: "modal" },
      { key: "loads", label: "load tests", present: "modal" },
      { key: "settings", label: "runtime settings", present: "modal" },
    ],
  };
}
