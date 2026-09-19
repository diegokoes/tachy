import { showCustomer, t } from "../terms";
import type { Issues } from "./rows";

export type IssueTone = "warn" | "danger";

type Message = {
  tone: IssueTone;
  /** The section on the page that fixes it. */
  section: string;
  /** The group's heading, from how many there are. */
  head: (n: number) => string;
  /** One line per named offender. Absent for a condition with no names. */
  item?: (label: string) => string;
  show?: () => boolean;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Every issue the server can report, worded here rather than there because the
 * deployment's words for teams, products and customers live in the SPA. A key
 * the server sends and this map does not know is dropped, not printed raw.
 */
const MESSAGES: Record<string, Message> = {
  "sources.untokened": {
    tone: "danger",
    section: "sources",
    head: (n) => `${plural(n, "source", "sources")} without a token`,
    item: (l) => `${l} has no token`,
  },
  "sources.refusing": {
    tone: "danger",
    section: "sources",
    head: (n) => `${plural(n, "source", "sources")} rejecting credentials`,
    item: (l) => `${l} refused its credentials in the last 14 days`,
  },
  "sources.never_synced": {
    tone: "warn",
    section: "sources",
    head: (n) => `${plural(n, "source", "sources")} never synced`,
    item: (l) => `${l} has never synced`,
  },
  "projects.no_wiki": {
    tone: "warn",
    section: "projects",
    head: (n) =>
      `${plural(n, "knowledge project", "knowledge projects")} without a wiki`,
    item: (l) => `${l} has no wiki`,
  },
  "repos.failing": {
    tone: "danger",
    section: "repos",
    head: (n) => `${plural(n, "repo", "repos")} failing to index`,
    item: (l) => `${l} failed to index`,
  },
  "repos.never_indexed": {
    tone: "warn",
    section: "repos",
    head: (n) => `${plural(n, "repo", "repos")} never indexed`,
    item: (l) => `${l} has never been indexed`,
  },
  "repos.no_component": {
    tone: "warn",
    section: "repos",
    head: (n) => `${plural(n, "repo", "repos")} without a component`,
    item: (l) => `${l} has no component`,
  },
  "repos.no_project": {
    tone: "warn",
    section: "repos",
    head: (n) => `${plural(n, "repo", "repos")} without a project`,
    item: (l) => `${l} belongs to no project`,
  },

  "teams.no_product": {
    tone: "warn",
    section: "teams",
    head: (n) => `${plural(n, t("team"), t("teams"))} that own nothing`,
    item: (l) => `${l} owns no ${t("products")}`,
  },
  "products.no_component": {
    tone: "warn",
    section: "products",
    head: (n) => `${plural(n, t("product"), t("products"))} with no components`,
    item: (l) => `${l} has no components`,
  },
  "components.no_description": {
    tone: "warn",
    section: "components",
    head: (n) => `${plural(n, "component", "components")} with no description`,
    item: (l) => `${l} has no description`,
  },
  "labels.no_description": {
    tone: "warn",
    section: "labels",
    head: (n) => `${plural(n, "label", "labels")} with no description`,
    item: (l) => `${l} has no description`,
  },
  "patterns.no_description": {
    tone: "warn",
    section: "patterns",
    head: (n) =>
      `${plural(n, "resolution pattern", "resolution patterns")} with no description`,
    item: (l) => `${l} has no description`,
  },
  "customers.no_domains": {
    tone: "warn",
    section: "customers",
    head: (n) =>
      `${plural(n, t("customer"), t("customers"))} with no email domain`,
    item: (l) => `${l} has no email domain`,
    show: showCustomer,
  },

  "users.no_app_admin": {
    tone: "danger",
    section: "users",
    head: () => "nobody is an app admin: users and settings cannot be managed",
  },
  "teams.no_admin": {
    tone: "warn",
    section: "users",
    head: (n) => `${plural(n, t("team"), t("teams"))} with no admin`,
    item: (l) => `${l} has no admin`,
  },
  "users.no_team": {
    tone: "warn",
    section: "users",
    head: (n) => `${plural(n, "user", "users")} in no ${t("team")}`,
    item: (l) => `${l} is in no ${t("team")}`,
  },

  "jobs.failing": {
    tone: "danger",
    section: "jobs",
    head: (n) => `${plural(n, "job", "jobs")} whose last run failed`,
    item: (l) => `${l}: last run failed`,
  },
  "jobs.disabled": {
    tone: "warn",
    section: "jobs",
    head: (n) => `${plural(n, "job", "jobs")} disabled as invalid`,
    item: (l) => `${l} was disabled`,
  },
  "jobs.stuck": {
    tone: "warn",
    section: "jobs",
    head: (n) => `${plural(n, "run", "runs")} waiting over 15 min for a worker`,
    item: (l) => `${l} is still queued`,
  },

  "system.not_ready": {
    tone: "danger",
    section: "runtime",
    head: () => "not ready",
    item: (l) => l,
  },
  "backups.failed": {
    tone: "danger",
    section: "host",
    head: () => "the last backup failed",
    item: (l) => l,
  },
  "backups.stale": {
    tone: "warn",
    section: "host",
    head: () => "no backup in the last 12 hours",
  },
  "restore.failed": {
    tone: "danger",
    section: "host",
    head: () => "the last restore test failed",
    item: (l) => l,
  },
  "restore.stale": {
    tone: "warn",
    section: "host",
    head: () => "no restore test in the last 8 days",
  },
  "watch.fail": {
    tone: "danger",
    section: "host",
    head: (n) => `${plural(n, "host check", "host checks")} failing`,
    item: (l) => l,
  },
  "watch.warn": {
    tone: "warn",
    section: "host",
    head: (n) => `${plural(n, "host check", "host checks")} warning`,
    item: (l) => l,
  },
  "vault.old_keys": {
    tone: "warn",
    section: "runtime",
    head: () => "credentials on an old vault key: run npm run sync rotate-key",
    item: (l) => `key ${l} credentials`,
  },
};

export type IssueGroup = {
  key: string;
  n: number;
  tone: IssueTone;
  section: string;
  head: string;
  items: { key: string; text: string }[];
  /** Named offenders past the ones listed. */
  more: number;
};

/** The open issues, worded, worst first. */
export function issueGroups(issues: Issues): IssueGroup[] {
  return Object.entries(issues)
    .flatMap(([key, v]) => {
      const m = MESSAGES[key];
      if (!m || !v || v.n <= 0 || (m.show && !m.show())) return [];
      const items = m.item
        ? v.items.map((it) => ({ key: it.key, text: m.item!(it.label) }))
        : [];
      return [
        {
          key,
          n: v.n,
          tone: m.tone,
          section: m.section,
          head: m.head(v.n),
          items,
          more: m.item ? Math.max(0, v.n - v.items.length) : 0,
        },
      ];
    })
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));
}

/** Every issue key the SPA can word. */
export const ISSUE_KEYS = Object.keys(MESSAGES);
