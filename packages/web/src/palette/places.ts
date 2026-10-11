/**
 * Everything the palette can open. A place has an address and is gone to; a
 * create opens a form, by its route where it has one and otherwise by pressing
 * the add its section already offers. Dialogs about one record never appear:
 * they need the record.
 */
import { isCurator, isGlobalAdmin } from "../access/session.svelte";
import { CONSOLE_PAGES, consoleSections } from "../admin/pages";
import { runWhenOffered } from "../admin/sectionAction.svelte";
import { actionKey, navKey } from "../keys/bindings.svelte";
import { openFeedback } from "../reports/feedback";
import { SETTINGS_TABS } from "../settings/tabs";
import { navItems } from "../shell/nav";
import { navigate, openSection } from "../shell/router.svelte";
import type { IconName } from "../tui/icons";
import { scopeOf, wikiLabel, wikiPath } from "../wiki/paths";
import { landingScope, wikis } from "../wiki/wikis.svelte";
import type { Searchable } from "./fuzzy";

export type Place = Searchable & {
  kind: "go" | "create";
  icon?: IconName;
  /** The place's own binding, shown so the palette teaches it. */
  hotkey?: string;
  run: () => void;
};

const GO = ["go", "to", "open"];
const CREATE = ["new", "create", "add"];

/** Words a place answers to beyond its label and trail, by console path. */
const ALIASES: Record<string, string[]> = {
  "integrations/bulk-link": ["repos", "linking"],
  "structure/map": ["coverage"],
};

function go(
  id: string,
  label: string,
  trail: string[],
  run: () => void,
  { keywords = [], ...rest }: Partial<Place> = {},
): Place {
  return {
    id,
    label,
    trail,
    keywords: [...GO, ...keywords],
    kind: "go",
    run,
    ...rest,
  };
}

const create = (
  id: string,
  label: string,
  trail: string[],
  icon: IconName,
  run: () => void,
): Place => ({ id, label, trail, keywords: CREATE, kind: "create", icon, run });

function sections(): Place[] {
  const tabs = navItems().map((n, i) =>
    go(`section:${n.key}`, n.label, [], () => openSection(n.key), {
      icon: n.icon,
      hotkey: navKey(n.key, i),
    }),
  );
  return [
    ...tabs,
    go("section:settings", "settings", [], () => openSection("settings"), {
      icon: "settings",
      hotkey: actionKey("settings"),
    }),
    go("section:feedback", "feedback", [], openFeedback, {
      icon: "flag",
      hotkey: actionKey("feedback"),
      keywords: ["report", "bug", "idea"],
    }),
  ];
}

function consolePlaces(): Place[] {
  const all = consoleSections();
  const admin = isGlobalAdmin();
  return CONSOLE_PAGES.flatMap((page) => {
    const trail = ["console", page.label];
    const pagePath = `/console/${page.key}`;
    const here = go(
      `console:${page.key}`,
      page.label,
      ["console"],
      () => navigate(pagePath),
      { icon: page.icon, keywords: [page.key, "overview"] },
    );
    const live = (all[page.key] ?? []).filter((s) => s.show !== false);
    const places = live.map((s) => {
      const path = `${pagePath}/${s.key}`;
      return go(
        `console:${page.key}/${s.key}`,
        s.label,
        trail,
        () => navigate(path),
        {
          icon: s.icon ?? page.icon,
          keywords: [s.key, ...(ALIASES[`${page.key}/${s.key}`] ?? [])],
        },
      );
    });
    const adds = admin
      ? live
          .filter((s) => s.add)
          .map((s) =>
            create(
              `add:${page.key}/${s.key}`,
              s.add!,
              [...trail, s.label],
              "plus",
              () => {
                navigate(`${pagePath}/${s.key}`);
                runWhenOffered(s.key);
              },
            ),
          )
      : [];
    return [here, ...places, ...adds];
  });
}

function settingsPlaces(): Place[] {
  return SETTINGS_TABS.map((tab) =>
    go(
      `settings:${tab.key}`,
      tab.label,
      ["settings"],
      () => navigate(`/settings/${tab.key}`),
      { icon: tab.icon },
    ),
  );
}

/** Each wiki, and the gaps and a new article of the one /wiki opens on. */
function wikiPlaces(): Place[] {
  if (!wikis.loaded) return [];
  const each = wikis.rows.map((w) =>
    go(
      `wiki:${scopeOf(w)}`,
      wikiLabel(w),
      ["wiki"],
      () => navigate(wikiPath(scopeOf(w))),
      { icon: "wiki" },
    ),
  );
  const scope = landingScope();
  const landing = wikis.rows.find((w) => scopeOf(w) === scope);
  const trail = ["wiki", ...(landing ? [wikiLabel(landing)] : [])];
  const gaps = go(
    `wiki-gaps:${scope}`,
    "gaps",
    trail,
    () => navigate(wikiPath(scope, "gaps")),
    { icon: "gaps" },
  );
  const article = isCurator()
    ? [
        create(`new:wiki/${scope}`, "new wiki article", trail, "wiki", () =>
          navigate(wikiPath(scope, "new")),
        ),
      ]
    : [];
  return [...each, gaps, ...article];
}

function libraryCreates(): Place[] {
  if (!isCurator()) return [];
  return [
    create("new:entry", "new knowledge entry", ["library"], "knowledge", () =>
      navigate("/library/new/entry"),
    ),
    create("new:doc", "new reference doc", ["library"], "refDoc", () =>
      navigate("/library/new/doc"),
    ),
  ];
}

/**
 * The whole catalogue, in the order an untouched palette lists it. Reads the
 * session, the keymap and the wikis, so derive from it rather than read it once.
 */
export function places(): Place[] {
  return [
    ...sections(),
    ...consolePlaces(),
    ...settingsPlaces(),
    ...wikiPlaces(),
    ...libraryCreates(),
  ];
}
