import { describe, expect, it } from "vitest";
import {
  libraryItemPath,
  movedWikiPath,
  wikiPath,
} from "../../packages/web/src/lib/wiki/paths";

const seg = (path: string) => path.slice(1).split("/");

describe("wiki paths", () => {
  it("builds every path in the section from one place", () => {
    expect(wikiPath("tqx")).toBe("/wiki/tqx");
    expect(wikiPath("tqx", "c", "printing")).toBe("/wiki/tqx/c/printing");
  });

  /** Chat history and the agent's older replies still say /library/wiki. */
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
    // contents and its older name toc both became the wiki's landing.
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
