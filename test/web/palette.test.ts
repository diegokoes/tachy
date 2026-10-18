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
import { FEEDBACK_FROM } from "../../packages/web/src/reports/feedback";
import { router } from "../../packages/web/src/shell/router.svelte";
import { wikis } from "../../packages/web/src/wiki/wikis.svelte";

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
    history.replaceState({}, "", "/");
    router.path = "/";
  });

  afterEach(() => {
    session.me = null;
  });

  it("lists every section with the key that opens it", () => {
    expect(byId("section:chat")).toMatchObject({ kind: "go", hotkey: "1" });
    expect(byId("section:settings")?.hotkey).toBe("6");
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
    byId("console:integrations")!.run();
    expect(router.path).toBe("/console/integrations");
    const repos = byId("console:integrations/repos")!;
    expect(repos.trail).toEqual(["console", "integrations"]);
    repos.run();
    expect(router.path).toBe("/console/integrations/repos");
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

    expect(byId("wiki:general")?.label).toBe("General (org-wide)");
    const gaps = byId("wiki-gaps:billing")!;
    expect(gaps.trail).toEqual(["wiki", "Billing"]);
    gaps.run();
    expect(router.path).toBe("/wiki/billing/gaps");
    byId("new:wiki/billing")!.run();
    expect(router.path).toBe("/wiki/billing/new");
  });

  it("gives every place a distinct id, for its pick count", () => {
    wikis.loaded = true;
    const all = ids();
    expect(new Set(all).size).toBe(all.length);
  });
});
