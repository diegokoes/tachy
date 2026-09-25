import { describe, expect, it } from "vitest";
import {
  libraryItemPath,
  movedWikiPath,
  wikiPath,
} from "../../packages/web/src/lib/wiki/paths";

const seg = (path: string) => path.slice(1).split("/");

describe("wiki paths", () => {
  it("builds every path in the section from one place", () => {
    expect(wikiPath("tpd")).toBe("/wiki/tpd");
    expect(wikiPath("tpd", "c", "printing")).toBe("/wiki/tpd/c/printing");
  });

  /** Chat history and the agent's older replies still say /library/wiki. */
  it("sends an old library path to where the page lives now", () => {
    expect(movedWikiPath(seg("/library/wiki"))).toBe("/wiki");
    expect(movedWikiPath(seg("/library/wiki/tpd"))).toBe("/wiki/tpd");
    expect(movedWikiPath(seg("/library/wiki/tpd/spooler"))).toBe(
      "/wiki/tpd/spooler",
    );
    expect(movedWikiPath(seg("/library/wiki/tpd/spooler/edit"))).toBe(
      "/wiki/tpd/spooler/edit",
    );
  });

  it("folds the old pages into where they live now", () => {
    // contents and its older name toc both became the wiki's landing.
    expect(movedWikiPath(seg("/library/wiki/tpd/toc"))).toBe("/wiki/tpd");
    expect(movedWikiPath(seg("/library/wiki/tpd/contents"))).toBe("/wiki/tpd");
    expect(movedWikiPath(seg("/library/wiki/tpd/coverage"))).toBe(
      "/wiki/tpd/gaps",
    );
  });

  it("routes a resolved link to an article, an entry or a doc", () => {
    expect(
      libraryItemPath({
        kind: "wiki",
        slug: "spooler",
        docId: "d",
        scope: "tpd",
      }),
    ).toBe("/wiki/tpd/spooler");
    expect(libraryItemPath({ entryId: "e1", scope: "tpd" })).toBe(
      "/library/entries/e1",
    );
    expect(
      libraryItemPath({ kind: "reference", docId: "d1", scope: "tpd" }),
    ).toBe("/library/docs/d1");
    expect(libraryItemPath({ scope: "tpd" })).toBeNull();
  });
});
