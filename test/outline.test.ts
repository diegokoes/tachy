import { describe, expect, it } from "vitest";
import { outline, withAnchors } from "../packages/web/src/lib/outline";

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
