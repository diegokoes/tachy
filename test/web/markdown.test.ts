/**
 * The sanitize step needs a DOM, so these exercise the layer that is this
 * codebase's own: the tokenizer, the renderer and the broken-link marking.
 * DOMPurify's stripping is its library's concern, and its one line of config
 * (ADD_ATTR) is verified against the running app.
 */
import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import {
  wikilinkExtension,
  imageRenderer,
  markBrokenLinks,
} from "../../packages/web/src/markdown/markdown";

const marked = new Marked({ gfm: true, breaks: true }).use({
  extensions: [wikilinkExtension as any],
});
const render = (src: string) => marked.parse(src, { async: false }) as string;

describe("wikilink rendering", () => {
  it("renders a link as an inert anchor carrying its target", () => {
    const html = render("See [[spooler-stalls]] now.");
    expect(html).toContain('data-wikilink="spooler-stalls"');
    expect(html).toContain(">spooler-stalls</a>");
    expect(html).not.toContain("href");
  });

  it("uses the label when one is given", () => {
    const html = render("[[spooler-stalls|the spooler]]");
    expect(html).toContain('data-wikilink="spooler-stalls"');
    expect(html).toContain(">the spooler</a>");
  });

  it("composes with ordinary markdown rather than replacing it", () => {
    const html = render("## Heading\n\n- item with [[a-link]]\n");
    expect(html).toContain("<h2>");
    expect(html).toContain("<li>");
    expect(html).toContain('data-wikilink="a-link"');
  });

  it("leaves a single bracket alone", () => {
    expect(render("[not a link]")).not.toContain("wikilink");
  });

  // A target cannot break out of the attribute it is written into.
  it("escapes quotes and angle brackets in the target and the label", () => {
    const html = render('[[a"b|<script>x</script>]]');
    expect(html).not.toContain('data-wikilink="a"b"');
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<script>");
  });

  it("marks links whose target did not resolve", () => {
    const html = render("[[real]] and [[missing]]");
    const rendered = markBrokenLinks(html, new Set(["real"]));
    expect(rendered).toMatch(
      /class="wikilink broken"[^>]*data-wikilink="missing"/,
    );
    expect(rendered).not.toMatch(
      /class="wikilink broken"[^>]*data-wikilink="real"/,
    );
  });

  it("leaves everything alone when every target resolves", () => {
    const html = render("[[a]] and [[b]]");
    expect(markBrokenLinks(html, new Set(["a", "b"]))).toBe(html);
  });
});

describe("wikilinks are reachable without a pointer", () => {
  it("renders them focusable and announced as links", () => {
    // There is no href to give them - the route a target resolves to is only
    // known once the server answers - so these two are what make the anchor
    // focusable and announce it as a link at all.
    const html = render("see [[line-controller]]");
    expect(html).toContain('role="link"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-wikilink="line-controller"');
  });

  it("marks a broken link without costing it keyboard access", () => {
    const rendered = markBrokenLinks(
      render("[[real]] and [[missing]]"),
      new Set(["real"]),
    );
    expect(rendered).toMatch(
      /class="wikilink broken"[^>]*data-wikilink="missing"/,
    );
    expect(rendered).toMatch(/class="wikilink broken"[^>]*tabindex="0"/);
  });
});

describe("markdown images", () => {
  const withImages = new Marked({ gfm: true }).use({ renderer: imageRenderer });
  const img = (src: string) =>
    withImages.parse(src, { async: false }) as string;
  const asset = "/api/library/assets/0b6a8f5e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

  it("renders one of the library's own images", () => {
    const rendered = img(`![the spooler](${asset} "queue")`);
    expect(rendered).toContain(`<img src="${asset}"`);
    expect(rendered).toContain('alt="the spooler"');
    expect(rendered).toContain('title="queue"');
    expect(rendered).toContain('loading="lazy"');
  });

  // An outside image is a request every reader's browser would make.
  it("shows an outside image as its alt text and never loads it", () => {
    const rendered = img("![leak](https://example.invalid/p.png?d=secret)");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("example.invalid");
    expect(rendered).toContain("leak");
  });

  it("refuses a path that only starts like an asset", () => {
    expect(img(`![x](${asset}/../../users)`)).not.toContain("<img");
    expect(img("![x](/api/library/assets/not-a-uuid)")).not.toContain("<img");
  });

  it("escapes the alt text either way", () => {
    expect(img(`![<b>"x"</b>](${asset})`)).toContain(
      'alt="&lt;b>&quot;x&quot;&lt;/b>"',
    );
    expect(img("![<b>x</b>](https://example.invalid/a.png)")).not.toContain(
      "<b>",
    );
  });
});
