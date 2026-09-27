import { describe, expect, it } from "vitest";
import {
  outline,
  outlineTree,
  withAnchors,
} from "../packages/web/src/lib/outline";

const numbers = (body: string) => outline(body).map((i) => i.number);

describe("article outline", () => {
  it("reads the headings, with their depth", () => {
    const items = outline(
      "## Overview\n\ntext\n\n### Queue\n\nmore\n\n## Failures\n",
    );
    expect(items.map((i) => [i.depth, i.text])).toEqual([
      [2, "Overview"],
      [3, "Queue"],
      [2, "Failures"],
    ]);
  });

  /** Two "Overview" headings must not produce two elements with one id, or the
      second contents link jumps to the first. */
  it("gives duplicate headings distinct anchors", () => {
    const items = outline(
      "## Overview\n\na\n\n## Overview\n\nb\n\n## Overview\n\nc",
    );
    expect(items.map((i) => i.id)).toEqual([
      "overview",
      "overview-1",
      "overview-2",
    ]);
  });

  it("survives headings that are only punctuation", () => {
    const items = outline("## ???\n\n## ***\n");
    expect(items.map((i) => i.id)).toEqual(["section", "section-1"]);
  });

  it("ignores non-heading content", () => {
    expect(outline("just prose\n\n- a list\n\n> a quote")).toEqual([]);
    expect(outline("")).toEqual([]);
  });

  it("stamps the rendered html with the same ids, in order", () => {
    const body = "## Overview\n\na\n\n### Queue\n\nb\n\n## Overview\n\nc";
    const items = outline(body);
    const html = withAnchors(
      "<h2>Overview</h2><p>a</p><h3>Queue</h3><p>b</p><h2>Overview</h2><p>c</p>",
      items,
    );
    for (const it of items) expect(html).toContain(`id="${it.id}"`);
    expect(html).toContain('<h2 id="overview">');
    expect(html).toContain('<h2 id="overview-1">');
  });

  it("leaves html alone when there are more headings than outline items", () => {
    const html = withAnchors("<h2>A</h2><h2>B</h2>", outline("## A"));
    expect(html).toBe('<h2 id="a">A</h2><h2>B</h2>');
  });
});

describe("section numbering", () => {
  it("numbers siblings and nests subsections", () => {
    expect(
      numbers("## A\n\n### A1\n\n### A2\n\n## B\n\n### B1\n\n#### B1a\n"),
    ).toEqual(["1", "1.1", "1.2", "2", "2.1", "2.1.1"]);
  });

  /** Nesting, not markdown depth: ## then #### is one level down, not two. */
  it("does not leave a hole for a skipped heading level", () => {
    expect(numbers("## A\n\n#### deep\n")).toEqual(["1", "1.1"]);
    expect(outline("## A\n\n#### deep\n").map((i) => i.level)).toEqual([0, 1]);
  });

  /** Climbing back out of a skipped level carries on that level's count. */
  it("continues the count when a heading climbs out of a skipped level", () => {
    expect(numbers("## A\n\n#### deep\n\n### shallower\n")).toEqual([
      "1",
      "1.1",
      "1.2",
    ]);
  });

  it("starts at 1 whatever depth the body opens on", () => {
    expect(numbers("### only\n\n### sections\n")).toEqual(["1", "2"]);
  });

  it("counts a level-one heading in the body like any other", () => {
    expect(numbers("# Title\n\n## Part\n\n# Next\n")).toEqual([
      "1",
      "1.1",
      "2",
    ]);
  });

  it("prints the number into the heading only when asked", () => {
    const items = outline("## A\n\n### B\n");
    const html = "<h2>A</h2><h3>B</h3>";
    expect(withAnchors(html, items)).not.toContain("secno");
    expect(withAnchors(html, items, { numbered: true })).toBe(
      '<h2 id="a"><span class="secno">1</span> A</h2>' +
        '<h3 id="b"><span class="secno">1.1</span> B</h3>',
    );
  });
});

describe("outline tree", () => {
  it("hangs each subsection under its section", () => {
    const tree = outlineTree(
      outline("## A\n\n### A1\n\n#### A1a\n\n### A2\n\n## B\n"),
    );
    expect(tree.map((n) => n.text)).toEqual(["A", "B"]);
    expect(tree[0].children.map((n) => n.text)).toEqual(["A1", "A2"]);
    expect(tree[0].children[0].children.map((n) => n.text)).toEqual(["A1a"]);
    expect(tree[1].children).toEqual([]);
  });

  it("is empty for a body with no headings", () => {
    expect(outlineTree(outline("prose only"))).toEqual([]);
  });
});
