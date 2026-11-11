import { describe, expect, it } from "vitest";
import {
  libraryTab,
  libraryTabPath,
  libraryTabs,
} from "../../packages/web/src/library/tabs";
import {
  libraryItemPath,
  movedWikiPath,
  wikiPath,
} from "../../packages/web/src/wiki/paths";

const seg = (path: string) => path.slice(1).split("/");

describe("wiki paths", () => {
  it("builds every path in the section from one place", () => {
    expect(wikiPath("tqx")).toBe("/wiki/tqx");
    expect(wikiPath("tqx", "c", "printing")).toBe("/wiki/tqx/c/printing");
  });

  // Chat history and the agent's older replies still say /library/wiki.
  it("sends an old library path to where the page lives now", () => {
    expect(movedWikiPath(seg("/library/wiki"))).toBe("/wiki");
    expect(movedWikiPath(seg("/library/wiki/tqx"))).toBe("/wiki/tqx");
    expect(movedWikiPath(seg("/library/wiki/tqx/spooler"))).toBe(
      "/wiki/tqx/spooler",
    );
    expect(movedWikiPath(seg("/library/wiki/tqx/spooler/edit"))).toBe(
      "/wiki/tqx/spooler/edit",
    );
  });

  it("folds the old pages into where they live now", () => {
    // `contents` and its older name `toc` both lead to the wiki's landing.
    expect(movedWikiPath(seg("/library/wiki/tqx/toc"))).toBe("/wiki/tqx");
    expect(movedWikiPath(seg("/library/wiki/tqx/contents"))).toBe("/wiki/tqx");
    expect(movedWikiPath(seg("/library/wiki/tqx/coverage"))).toBe(
      "/wiki/tqx/gaps",
    );
  });

  it("routes a resolved link to an article, an entry or a doc", () => {
    expect(
      libraryItemPath({
        kind: "wiki",
        slug: "spooler",
        docId: "d",
        scope: "tqx",
      }),
    ).toBe("/wiki/tqx/spooler");
    expect(libraryItemPath({ entryId: "e1", scope: "tqx" })).toBe(
      "/library/entries/e1",
    );
    expect(
      libraryItemPath({ kind: "reference", docId: "d1", scope: "tqx" }),
    ).toBe("/library/docs/d1");
    expect(libraryItemPath({ scope: "tqx" })).toBeNull();
  });
});

describe("library tabs", () => {
  it("knows which tab a path is under", () => {
    expect(libraryTab("/library")).toBe("all");
    expect(libraryTab("/library/entries/e1")).toBe("all");
    expect(libraryTab("/wiki/tqx")).toBe("wiki");
    expect(libraryTab("/wiki/tqx/glossary")).toBe("wiki");
    expect(libraryTab("/wiki/tqx/gaps")).toBe("gaps");
    expect(libraryTab("/customers/ivk/pln191")).toBe("customers");
    expect(libraryTab("/review/p1")).toBe("review");
  });

  it("offers the customers tab only where customers exist", () => {
    expect(libraryTabs({ customers: false }).map((t) => t.key)).toEqual([
      "all",
      "wiki",
      "gaps",
      "review",
    ]);
    expect(libraryTabs({ customers: true }).map((t) => t.key)).toContain(
      "customers",
    );
    expect(libraryTabPath("customers", "tqx")).toBe("/customers");
  });

  it("ends on the review tab, carrying what waits there", () => {
    const review = libraryTabs({ customers: true, waiting: 4 }).at(-1);
    expect(review).toMatchObject({ key: "review", count: 4 });
    expect(libraryTabPath("review", "tqx")).toBe("/review");
  });

  it("sends the wiki tabs to the wiki in view", () => {
    expect(libraryTabPath("all", "tqx")).toBe("/library");
    expect(libraryTabPath("wiki", "tqx")).toBe("/wiki/tqx");
    expect(libraryTabPath("gaps", "general")).toBe("/wiki/general/gaps");
  });
});
