import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import {
  wikilinkExtension,
  markBrokenLinks,
} from "../packages/web/src/lib/markdown";

/**
 * The sanitize step needs a DOM, so these exercise the layer that is this
 * codebase's own: the tokenizer, the renderer and the broken-link marking.
 * DOMPurify's stripping is its library's concern, and its one line of config
 * (ADD_ATTR) is verified against the running app.
 */
const md = new Marked({ gfm: true, breaks: true }).use({
  extensions: [wikilinkExtension as any],
});
const render = (src: string) => md.parse(src, { async: false }) as string;

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

  /** A target cannot break out of the attribute it is written into. */
  it("escapes quotes and angle brackets in the target and the label", () => {
    const html = render('[[a"b|<script>x</script>]]');
    expect(html).not.toContain('data-wikilink="a"b"');
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<script>");
  });

  it("marks links whose target did not resolve", () => {
    const html = render("[[real]] and [[missing]]");
    const out = markBrokenLinks(html, new Set(["real"]));
    expect(out).toMatch(/class="wikilink broken"[^>]*data-wikilink="missing"/);
    expect(out).not.toMatch(/class="wikilink broken"[^>]*data-wikilink="real"/);
  });

  it("leaves everything alone when every target resolves", () => {
    const html = render("[[a]] and [[b]]");
    expect(markBrokenLinks(html, new Set(["a", "b"]))).toBe(html);
  });
});

describe("wikilinks are reachable without a pointer", () => {
  it("renders them focusable and announced as links", () => {
    // There is no href to give them — the route a target resolves to is only
    // known once the server answers — so these two are what make the anchor
    // focusable and announce it as a link at all.
    const html = render("see [[line-controller]]");
    expect(html).toContain('role="link"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-wikilink="line-controller"');
  });

  it("marks a broken link without costing it keyboard access", () => {
    const out = markBrokenLinks(
      render("[[real]] and [[missing]]"),
      new Set(["real"]),
    );
    expect(out).toMatch(/class="wikilink broken"[^>]*data-wikilink="missing"/);
    expect(out).toMatch(/class="wikilink broken"[^>]*tabindex="0"/);
  });
});
