/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { session } from "../../packages/web/src/access/session.svelte";
import {
  CONSOLE_PAGES,
  consoleSections,
} from "../../packages/web/src/admin/pages";
import { claimSectionAction } from "../../packages/web/src/admin/sectionAction.svelte";
import {
  addEntry,
  canRestore,
  chat,
  forgetCleared,
} from "../../packages/web/src/chat/chatState.svelte";
import {
  resetKeys,
  setNavKey,
} from "../../packages/web/src/keys/bindings.svelte";
import {
  match,
  rank,
  runs,
  type Searchable,
} from "../../packages/web/src/palette/fuzzy";
import { places } from "../../packages/web/src/palette/places";
import { countPick, picks } from "../../packages/web/src/palette/usage";
import { setVim, vimState } from "../../packages/web/src/keys/vim.svelte";
import { FEEDBACK_FROM } from "../../packages/web/src/reports/feedback";
import { router } from "../../packages/web/src/shell/router.svelte";
import { setTheme } from "../../packages/web/src/theme/theme.svelte";
import { wikis } from "../../packages/web/src/wiki/wikis.svelte";
import { az } from "../../packages/web/src/work-items/az.svelte";
import { boardAsk } from "../../packages/web/src/work-items/board.svelte";

const item = (
  id: string,
  label: string,
  trail: string[] = [],
  keywords: string[] = [],
): Searchable => ({ id, label, trail, keywords });

const labels = (ranked: { item: Searchable }[]) =>
  ranked.map((r) => r.item.label);

describe("match", () => {
  it("finds a term's letters in order and says where", () => {
    expect(match("rps", "repos")?.at).toEqual([0, 2, 4]);
    expect(match("REPO", "repos")?.at).toEqual([0, 1, 2, 3]);
  });

  it("refuses letters out of order or missing", () => {
    expect(match("ser", "repos")).toBeNull();
    expect(match("x", "repos")).toBeNull();
    expect(match("reposs", "repos")).toBeNull();
  });

  it("matches anything with an empty term", () => {
    expect(match("", "repos")).toEqual({ score: 0, at: [] });
  });

  it("scores a run above the same letters scattered", () => {
    const run = match("link", "bulk link")!.score;
    const scattered = match("link", "l-i-n-k")!.score;
    expect(run).toBeGreaterThan(scattered);
  });

  it("prefers the placement on word starts", () => {
    // "bl" on "bulk link" lands b-ulk l-ink, not the l inside "bulk".
    expect(match("bl", "bulk link")?.at).toEqual([0, 5]);
  });

  it("scores the text's first letter above a later word start", () => {
    expect(match("rep", "repos")!.score).toBeGreaterThan(
      match("rep", "link repository")!.score,
    );
  });
});

describe("runs", () => {
  it("cuts a label into matched and unmatched runs", () => {
    expect(runs("repos", [0, 1, 4])).toEqual([
      { text: "re", hit: true },
      { text: "po", hit: false },
      { text: "s", hit: true },
    ]);
    expect(runs("ab", [])).toEqual([{ text: "ab", hit: false }]);
    expect(runs("", [])).toEqual([]);
  });
});

describe("rank", () => {
  const catalogue = [
    item("chat", "chat", [], ["go", "to"]),
    item("repos", "repos", ["console", "integrations"], ["go", "to"]),
    item("bulk", "bulk link", ["console", "integrations"], ["repos"]),
    item("team", "add team", ["console", "structure"], ["new", "create"]),
    item("link", "link repository", ["console", "integrations"], ["new"]),
  ];

  it("keeps every item for an empty query, most picked first", () => {
    expect(labels(rank(catalogue, "  ", {}))).toEqual(
      catalogue.map((c) => c.label),
    );
    expect(labels(rank(catalogue, "", { bulk: 3, team: 1 }))).toEqual([
      "bulk link",
      "add team",
      "chat",
      "repos",
      "link repository",
    ]);
  });

  it("needs every word of the query to land somewhere", () => {
    expect(labels(rank(catalogue, "bulk repo", {}))).toEqual(["bulk link"]);
    expect(labels(rank(catalogue, "new team", {}))).toEqual(["add team"]);
    expect(labels(rank(catalogue, "go to repos", {}))).toEqual(["repos"]);
    expect(rank(catalogue, "zzz", {})).toEqual([]);
  });

  it("puts a label hit above a trail or keyword hit", () => {
    expect(labels(rank(catalogue, "repo", {}))[0]).toBe("repos");
    expect(labels(rank(catalogue, "repo", {}))).toContain("bulk link");
  });

  it("highlights only what matched in the label", () => {
    const [top] = rank(catalogue, "bulk repo", {});
    expect(top.hits).toEqual([0, 1, 2, 3]);
  });

  it("breaks a tie on picks, then on catalogue order", () => {
    const twins = [item("a", "jobs"), item("b", "jobs")];
    expect(rank(twins, "jobs", {}).map((r) => r.item.id)).toEqual(["a", "b"]);
    expect(rank(twins, "jobs", { b: 2 }).map((r) => r.item.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("usage", () => {
  beforeEach(() => localStorage.clear());

  it("counts picks across reads", () => {
    countPick("console:integrations");
    countPick("console:integrations");
    countPick("section:chat");
    expect(picks()).toEqual({ "console:integrations": 2, "section:chat": 1 });
  });

  it("reads anything but a map of counts as none", () => {
    localStorage.setItem("tachy-palette", "[1,2]");
    expect(picks()).toEqual({});
    localStorage.setItem("tachy-palette", "{not json");
    expect(picks()).toEqual({});
  });

  it("survives storage that throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => countPick("section:chat")).not.toThrow();
    spy.mockRestore();
  });
});

describe("the console map", () => {
  it("has a page for every page of sections", () => {
    const pages = CONSOLE_PAGES.map((p) => p.key).sort();
    expect(Object.keys(consoleSections()).sort()).toEqual(pages);
  });
});

describe("places", () => {
  const admin = {
    email: "a@example.com",
    name: null,
    role: "admin" as const,
    via: "password" as const,
  };
  const member = { ...admin, role: "member" as const, team_admin: [] };

  const byId = (id: string) => places().find((p) => p.id === id);
  const ids = () => places().map((p) => p.id);

  beforeEach(() => {
    localStorage.clear();
    resetKeys();
    session.me = admin;
    session.config = null;
    session.unreachable = false;
    wikis.rows = [];
    wikis.loaded = false;
    az.projects = null;
    boardAsk.newItem = false;
    forgetCleared();
    chat.entries = [];
    chat.busy = false;
    history.replaceState({}, "", "/");
    router.path = "/";
  });

  afterEach(() => {
    session.me = null;
  });

  it("lists every section with the key that opens it", () => {
    expect(byId("section:chat")).toMatchObject({ kind: "go", hotkey: "1" });
    expect(byId("section:settings")?.hotkey).toBe("5");
    expect(byId("section:feedback")?.hotkey).toBe("ctrl+.");
    setNavKey("chat", "c");
    expect(byId("section:chat")?.hotkey).toBe("c");
  });

  it("opens a section where it was left", () => {
    byId("section:wiki")!.run();
    expect(router.path).toBe("/wiki");
  });

  it("notes where feedback was asked for", () => {
    router.path = "/console/structure";
    byId("section:feedback")!.run();
    expect(sessionStorage.getItem(FEEDBACK_FROM)).toBe("/console/structure");
    expect(router.path).toBe("/feedback");
  });

  it("goes to a console page's overview and to each section", () => {
    expect(byId("console:integrations")?.label).toBe("integrations overview");
    byId("console:integrations")!.run();
    expect(router.path).toBe("/console/integrations");
    const repos = byId("console:integrations/repos")!;
    expect(repos.trail).toEqual(["console", "integrations"]);
    repos.run();
    expect(router.path).toBe("/console/integrations/repos");
  });

  it("goes to the usage page, which has an overview and no sections", () => {
    expect(byId("console:usage")?.label).toBe("usage overview");
    byId("console:usage")!.run();
    expect(router.path).toBe("/console/usage");
  });

  it("leaves out a page that only opens its first section", () => {
    expect(byId("console:flows")).toBeUndefined();
    expect(byId("console:flows/forms")?.trail).toEqual(["console", "flows"]);
  });

  it("tells the team catalog from the team rosters", () => {
    expect(byId("console:structure/teams")?.label).toBe("teams");
    expect(byId("console:access/teams")?.label).toBe("team members");
  });

  it("finds bulk linking by the words people use for it", () => {
    const [top] = rank(places(), "bulk repo linking", {});
    expect(top.item.id).toBe("console:integrations/bulk-link");
  });

  it("leaves out a section the session cannot see", () => {
    expect(ids()).toContain("console:system/audit");
    session.me = member;
    expect(ids()).not.toContain("console:system/audit");
  });

  it("offers a section's add to an admin, and presses it on arrival", () => {
    const add = byId("add:structure/teams")!;
    expect(add).toMatchObject({ kind: "create", label: "add team" });

    const run = vi.fn();
    const release = claimSectionAction("teams", { label: "add team", run });
    add.run();
    expect(router.path).toBe("/console/structure/teams");
    return vi
      .waitFor(() => expect(run).toHaveBeenCalledOnce())
      .finally(release);
  });

  it("offers creates only to those who can make them", () => {
    expect(ids()).toEqual(
      expect.arrayContaining(["add:access/users", "new:entry", "new:doc"]),
    );
    session.me = member;
    expect(ids().filter((id) => /^(add|new):/.test(id))).toEqual([]);
  });

  it("opens the settings tabs and the library's create screens", () => {
    byId("settings:keybinds")!.run();
    expect(router.path).toBe("/settings/keybinds");
    byId("new:doc")!.run();
    expect(router.path).toBe("/library/new/doc");
  });

  it("opens the wiki, which has no tab, before the wikis load", () => {
    expect(byId("section:wiki")).toMatchObject({
      kind: "go",
      trail: ["library"],
    });
    expect(byId("section:wiki")?.hotkey).toBeUndefined();
  });

  it("lists each wiki once they have loaded, and the landing one's pages", () => {
    expect(ids().some((id) => id.startsWith("wiki"))).toBe(false);
    wikis.rows = [
      {
        product_slug: null,
        product_name: null,
        articles: 2,
      },
      {
        product_slug: "billing",
        product_name: "Billing",
        articles: 9,
      },
    ] as unknown as typeof wikis.rows;
    wikis.loaded = true;

    expect(byId("wiki:general")?.label).toBe("general (org-wide)");
    const gaps = byId("wiki-gaps:billing")!;
    expect(gaps.trail).toEqual(["wiki", "Billing"]);
    gaps.run();
    expect(router.path).toBe("/wiki/billing/gaps");
    byId("new:wiki/billing")!.run();
    expect(router.path).toBe("/wiki/billing/new");
  });

  const projects = [
    { id: "p1", name: "Fabric" },
    { id: "p2", name: "Ledger" },
  ] as unknown as NonNullable<typeof az.projects>;

  it("lists the board's projects, and starts an item on the landing one", () => {
    expect(ids().some((id) => id.startsWith("board:"))).toBe(false);
    az.projects = projects;
    byId("board:p2")!.run();
    expect(router.path).toBe("/board/azure-devops/p2");

    const add = byId("new:work-item")!;
    expect(add).toMatchObject({ kind: "create", trail: ["board", "Fabric"] });
    add.run();
    expect(router.path).toBe("/board/azure-devops/p1");
    expect(boardAsk.newItem).toBe(true);
  });

  it("switches vim and the theme, naming the way each would go", () => {
    expect(byId("do:vim")).toMatchObject({
      kind: "do",
      label: "vim motions on",
    });
    byId("do:vim")!.run();
    expect(vimState.enabled).toBe(true);
    expect(byId("do:vim")?.label).toBe("vim motions off");
    setVim(false);

    setTheme("dark");
    expect(byId("do:theme")?.label).toBe("light theme");
    byId("do:theme")!.run();
    expect(byId("do:theme")?.label).toBe("dark theme");
    setTheme("dark");
  });

  it("signs out only someone signed in", () => {
    expect(ids()).toContain("do:sign-out");
    session.me = null;
    expect(ids()).not.toContain("do:sign-out");
  });

  it("starts a new chat only over a finished conversation", () => {
    expect(ids()).not.toContain("do:new-chat");
    addEntry({ kind: "user", text: "why is the export empty?" });
    chat.busy = true;
    expect(ids()).not.toContain("do:new-chat");
    chat.busy = false;

    router.path = "/library";
    byId("do:new-chat")!.run();
    expect(chat.entries).toEqual([]);
    expect(canRestore()).toBe(true);
    expect(router.path).toBe("/chat");
  });

  it("gives every place a distinct id, for its pick count", () => {
    wikis.loaded = true;
    const all = ids();
    expect(new Set(all).size).toBe(all.length);
  });

  it("names every place once, so a row says where it goes", () => {
    wikis.rows = [
      { product_slug: "billing", product_name: "Billing", articles: 9 },
    ] as unknown as typeof wikis.rows;
    wikis.loaded = true;
    az.projects = projects;
    addEntry({ kind: "user", text: "why is the export empty?" });
    const names = places().map((p) => p.label);
    const twice = names.filter((name, i) => names.indexOf(name) !== i);
    expect(twice).toEqual([]);
  });
});
