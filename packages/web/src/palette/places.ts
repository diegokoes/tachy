/**
 * Everything the palette can open or do. A place has an address and is gone
 * to; a create opens a form, by its route where it has one and otherwise by
 * pressing the add its section already offers; a command acts where the
 * palette was opened. Dialogs about one record never appear: they need the
 * record.
 */
import {
  isCurator,
  isGlobalAdmin,
  logout,
  session,
} from "../access/session.svelte";
import { CONSOLE_PAGES, consoleSections } from "../admin/pages";
import { runWhenOffered } from "../admin/sectionAction.svelte";
import { canClear, clearConversation } from "../chat/clearing";
import { actionKey, navKey } from "../keys/bindings.svelte";
import { setVim, vimState } from "../keys/vim.svelte";
import { openFeedback } from "../reports/feedback";
import { SETTINGS_TABS } from "../settings/tabs";
import { navItems } from "../shell/nav";
import { navigate, openSection } from "../shell/router.svelte";
import { setTheme, themeState } from "../theme/theme.svelte";
import type { IconName } from "../tui/icons";
import { scopeOf, wikiLabel, wikiPath } from "../wiki/paths";
import { landingScope, wikis } from "../wiki/wikis.svelte";
import { az } from "../work-items/az.svelte";
import { boardListPath } from "../work-items/board";
import { boardAsk, landingProject } from "../work-items/board.svelte";
import type { Searchable } from "./fuzzy";

export type Place = Searchable & {
  kind: "go" | "create" | "do";
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

const command = (
  id: string,
  label: string,
  trail: string[],
  icon: IconName,
  run: () => void,
  keywords: string[],
): Place => ({ id, label, trail, keywords, kind: "do", icon, run });

function sections(): Place[] {
  const tabs = navItems().map((n, i) =>
    go(`section:${n.key}`, n.label, [], () => openSection(n.key), {
      icon: n.icon,
      hotkey: navKey(n.key, i),
    }),
  );
  return [
    ...tabs,
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
    // A page with no overview only opens its first section, which has a row.
    const here =
      page.overview === false
        ? []
        : [
            go(
              `console:${page.key}`,
              `${page.label} overview`,
              ["console"],
              () => navigate(pagePath),
              { icon: page.icon, keywords: [page.key] },
            ),
          ];
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
    return [...here, ...places, ...adds];
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

/**
 * The wiki, which has no tab of its own; each wiki; and the gaps and a new
 * article of the one /wiki opens on.
 */
function wikiPlaces(): Place[] {
  const wiki = go(
    "section:wiki",
    "wiki",
    ["library"],
    () => openSection("wiki"),
    { icon: "wiki" },
  );
  if (!wikis.loaded) return [wiki];
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
  return [wiki, ...each, gaps, ...article];
}

/** Each project the board lists, and a new item on the one it opens on. */
function boardPlaces(): Place[] {
  const projects = az.projects ?? [];
  const each = projects.map((p) =>
    go(
      `board:${p.id}`,
      p.name,
      ["board"],
      () => navigate(boardListPath(p.id)),
      { icon: "project" },
    ),
  );
  const landingId = landingProject();
  const landing = projects.find((p) => p.id === landingId);
  if (!landing) return each;
  const newItem = create(
    "new:work-item",
    "new work item",
    ["board", landing.name],
    "plus",
    () => {
      navigate(boardListPath(landing.id));
      boardAsk.newItem = true;
    },
  );
  return [...each, newItem];
}

/** Switches the reader would otherwise find under settings, and the way out. */
function commands(): Place[] {
  const vim = vimState.enabled;
  const otherTheme = themeState.theme === "dark" ? "light" : "dark";
  const newChat = canClear()
    ? [
        command(
          "do:new-chat",
          "new chat",
          ["chat"],
          "chat",
          () => {
            clearConversation();
            openSection("chat");
          },
          ["clear", "conversation"],
        ),
      ]
    : [];
  const signOut = session.me
    ? [
        command(
          "do:sign-out",
          "sign out",
          ["settings", "account"],
          "logout",
          () => void logout(),
          ["log out", "logout"],
        ),
      ]
    : [];
  return [
    command(
      "do:vim",
      vim ? "vim motions off" : "vim motions on",
      ["settings", "keybinds"],
      "keybinds",
      () => setVim(!vim),
      ["vim", "keys"],
    ),
    command(
      "do:theme",
      `${otherTheme} theme`,
      ["settings", "theme"],
      "theme",
      () => setTheme(otherTheme),
      ["mode", "light", "dark"],
    ),
    ...newChat,
    ...signOut,
  ];
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
 * session, the keymap, the wikis, the board's projects and the switches, so
 * derive from it rather than read it once.
 */
export function places(): Place[] {
  return [
    ...sections(),
    ...consolePlaces(),
    ...settingsPlaces(),
    ...wikiPlaces(),
    ...libraryCreates(),
    ...boardPlaces(),
    ...commands(),
  ];
}
