import { marked } from "marked";
import type { Tokens } from "marked";
import DOMPurify from "dompurify";
import { ASSET_SRC_RE, parseWikilink, WIKILINK_RE } from "@tachy/contract";

marked.setOptions({ gfm: true, breaks: true });

/**
 * [[wikilinks]] as a real inline token, so they compose with the rest of
 * markdown instead of being string-replaced into it. The parser is the
 * contract's, the same one the server extracts edges with — two parsers that
 * could disagree would let a rendered link have no stored edge.
 *
 * The output is a plain anchor carrying its target in a data attribute; nothing
 * executes, and DOMPurify still sees ordinary HTML. Resolution happens at click
 * time, in the view that knows which wiki it is in.
 */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Exported so it can be exercised without a DOM: the tokenizer and renderer are
 * this codebase's logic, while the sanitize step below is DOMPurify's.
 */
export const wikilinkExtension = {
  name: "wikilink",
  level: "inline" as const,
  start: (src: string) => src.indexOf("[["),
  tokenizer(src: string) {
    const m = new RegExp(WIKILINK_RE.source).exec(src);
    if (!m || m.index !== 0) return undefined;
    return { type: "wikilink", raw: m[0], ...parseWikilink(m[1], m[2]) };
  },
  renderer(token: any) {
    /*
     * role and tabindex, because there is no href to give it: the route a
     * target resolves to is only known once the server has answered, and until
     * then an anchor without href is not focusable and is not announced as a
     * link. LinkTargets.onKeydown is the other half — without it these would be
     * reachable by keyboard and still not followable.
     */
    return `<a class="wikilink" role="link" tabindex="0" data-wikilink="${esc(token.target)}">${esc(token.label)}</a>`;
  },
};

/**
 * A markdown image renders only when it is one of ours; anything else is shown
 * as its alt text. See ASSET_SRC_RE for why an outside image is never fetched.
 */
export const imageRenderer = {
  image({ href, title, text }: Tokens.Image): string {
    if (!ASSET_SRC_RE.test(href)) return esc(text);
    const titled = title ? ` title="${esc(title)}"` : "";
    return `<img src="${esc(href)}" alt="${esc(text)}"${titled} loading="lazy">`;
  },
};

marked.use({ extensions: [wikilinkExtension], renderer: imageRenderer });

/**
 * The renderer above only sees markdown images. A body can also carry a raw
 * `<img>`, which marked passes through untouched, so the same rule is applied
 * again to what the sanitizer is about to keep.
 */
function firstPartyImagesOnly(node: Element) {
  if (
    node.nodeName === "IMG" &&
    !ASSET_SRC_RE.test(node.getAttribute("src") ?? "")
  )
    node.remove();
}

export function renderMarkdown(src: string): string {
  // Added and removed per call rather than once at import: without a DOM,
  // DOMPurify has no hook API at all, and the DOM-free tests import this file.
  DOMPurify.addHook("afterSanitizeAttributes", firstPartyImagesOnly);
  try {
    return DOMPurify.sanitize(marked.parse(src, { async: false }), {
      // DOMPurify allows every data-* attribute by default. Article bodies are
      // untrusted, so close that and re-open only the one the wikilink renderer
      // emits — ADD_ATTR extends ALLOWED_ATTR, which is checked independently
      // of the data-* rule.
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: ["data-wikilink", "role", "tabindex", "loading"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", firstPartyImagesOnly);
  }
}

/**
 * Mark links whose target does not resolve, so a rename is visible instead of
 * silently dead. `resolved` is the set of targets the server found a row for.
 */
export function markBrokenLinks(html: string, resolved: Set<string>): string {
  // Rewrites only the class and leaves the a11y attributes between it and
  // data-wikilink alone. A pattern for the whole opening tag stops matching as
  // soon as an attribute is added.
  return html.replace(
    /<a class="wikilink"((?:\s+[a-z-]+="[^"]*")*?\s+data-wikilink="([^"]*)")/g,
    (match, rest: string, target: string) =>
      resolved.has(target)
        ? match
        : `<a class="wikilink broken" title="no such article yet"${rest}`,
  );
}
