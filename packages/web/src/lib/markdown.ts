import { marked } from "marked";
import type { Tokens } from "marked";
import DOMPurify from "dompurify";
import { ASSET_SRC_RE, parseWikilink, WIKILINK_RE } from "@tachy/contract";
import { GRID, ICONS, type IconName } from "./tui/icons";
import { highlight } from "./code";

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
 *
 * `![alt|300](src)` and `![alt|300x200](src)` size it, the way Obsidian does.
 */
export const imageRenderer = {
  image({ href, title, text }: Tokens.Image): string {
    const sized = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(text);
    const alt = sized ? sized[1].trim() : text;
    if (!ASSET_SRC_RE.test(href)) return esc(alt);
    const titled = title ? ` title="${esc(title)}"` : "";
    const size = sized
      ? ` width="${sized[2]}"${sized[3] ? ` height="${sized[3]}"` : ""}`
      : "";
    return `<img src="${esc(href)}" alt="${esc(alt)}"${titled}${size} loading="lazy">`;
  },
};

/** The types the editor offers; CALLOUTS below also answers to their aliases. */
export const CALLOUT_TYPES = [
  "note",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
  "abstract",
] as const;

type CalloutTone = "info" | "ok" | "warn" | "danger" | "accent" | "muted";

/** Obsidian's callout types and aliases, onto the app's tones and icons. */
const CALLOUTS: Record<string, [CalloutTone, IconName]> = {
  note: ["info", "edit"],
  abstract: ["info", "file"],
  summary: ["info", "file"],
  tldr: ["info", "file"],
  info: ["info", "info"],
  todo: ["info", "success"],
  tip: ["ok", "lightbulb"],
  hint: ["ok", "lightbulb"],
  important: ["ok", "lightbulb"],
  success: ["ok", "success"],
  check: ["ok", "success"],
  done: ["ok", "success"],
  question: ["warn", "question"],
  help: ["warn", "question"],
  faq: ["warn", "question"],
  warning: ["warn", "alert"],
  caution: ["warn", "alert"],
  attention: ["warn", "alert"],
  failure: ["danger", "close"],
  fail: ["danger", "close"],
  missing: ["danger", "close"],
  danger: ["danger", "error"],
  error: ["danger", "error"],
  bug: ["danger", "bug"],
  example: ["accent", "file"],
  quote: ["muted", "quote"],
  cite: ["muted", "quote"],
};

const iconSvg = (name: IconName) =>
  `<svg class="callout-icon" viewBox="0 0 ${GRID} ${GRID}" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="${(6 * GRID) / 100}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name].path}</svg>`;

/**
 * `> [!tip] Title` blockquotes as Obsidian callouts. A `-` or `+` after the
 * type makes it foldable, shut or open. Unknown types keep their name as the
 * title and take the note's look, as Obsidian does.
 */
export const calloutRenderer = {
  blockquote({ text }: Tokens.Blockquote): string | false {
    const m = /^\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)\n?([\s\S]*)$/.exec(text);
    if (!m) return false;
    const [, type, fold, title, body] = m;
    const [tone, icon] = CALLOUTS[type.toLowerCase()] ?? CALLOUTS.note;
    const name = title.trim()
      ? marked.parseInline(title, { async: false })
      : esc(type.charAt(0).toUpperCase() + type.slice(1).toLowerCase());
    const inner = body.trim()
      ? `<div class="callout-body">${marked.parse(body, { async: false })}</div>`
      : "";
    const head = `${iconSvg(icon)}<span>${name}</span>`;
    return fold
      ? `<details class="callout callout-${tone}"${fold === "+" ? " open" : ""}><summary class="callout-title">${head}</summary>${inner}</details>`
      : `<div class="callout callout-${tone}"><div class="callout-title">${head}</div>${inner}</div>`;
  },
};

/** Fenced code, coloured for the languages `./code` carries. */
export const codeRenderer = {
  code({ text, lang }: Tokens.Code): string {
    const name = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
    const lit = highlight(text, name);
    const cls = lit.language
      ? ` class="hljs language-${esc(lit.language)}"`
      : "";
    return `<pre><code${cls}>${lit.html}</code></pre>`;
  },
};

marked.use({
  extensions: [wikilinkExtension],
  renderer: { ...imageRenderer, ...calloutRenderer, ...codeRenderer },
});

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
