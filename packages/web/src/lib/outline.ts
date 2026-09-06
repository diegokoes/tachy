import { marked } from "marked";

export interface OutlineItem {
  depth: number;
  text: string;
  id: string;
}

/**
 * A slug for a heading anchor. Kept in step with `outline()` below, which is
 * what numbers duplicates — "Overview" twice must not produce two elements with
 * the same id, or the second link jumps to the first.
 */
function anchorId(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

/**
 * The article's own table of contents, read from its markdown headings. Nothing
 * is stored: the outline is a function of the body, so it cannot drift from it.
 */
export function outline(body: string): OutlineItem[] {
  const seen = new Map<string, number>();
  const out: OutlineItem[] = [];
  for (const token of marked.lexer(body ?? "")) {
    if (token.type !== "heading") continue;
    const { depth, text } = token as { depth: number; text: string };
    out.push({ depth, text, id: anchorId(text, seen) });
  }
  return out;
}

/**
 * The same numbering the outline uses, applied to the rendered HTML, so a
 * heading's id matches the link that points at it.
 */
export function withAnchors(html: string, items: OutlineItem[]): string {
  let i = 0;
  return html.replace(/<(h[1-6])(\s[^>]*)?>/g, (match, tag, attrs) => {
    const item = items[i++];
    if (!item) return match;
    return `<${tag}${attrs ?? ""} id="${item.id}">`;
  });
}
