import { marked } from "marked";

export interface OutlineItem {
  depth: number;
  text: string;
  id: string;
  /** "2.1" — the heading's place in the outline, as the reader sees it. */
  number: string;
  /** 0 for a top-level section, 1 for its subsections, and so on. */
  level: number;
}

export interface OutlineNode extends OutlineItem {
  children: OutlineNode[];
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
 *
 * Numbered by nesting rather than by markdown depth, so a body that jumps from
 * ## to #### gets 1.1 and not 1.0.1, and one that opens on ### still starts at
 * 1. A heading that climbs back out of a skipped level carries on that level's
 * count, so ## · #### · ### reads 1 · 1.1 · 1.2 rather than repeating 1.1.
 */
export function outline(body: string): OutlineItem[] {
  const seen = new Map<string, number>();
  const out: OutlineItem[] = [];
  const open: { depth: number; n: number }[] = [];
  for (const token of marked.lexer(body ?? "")) {
    if (token.type !== "heading") continue;
    const { depth, text } = token as { depth: number; text: string };
    let closed: { depth: number; n: number } | undefined;
    while (open.length && open[open.length - 1].depth > depth)
      closed = open.pop();
    const top = open[open.length - 1];
    if (top?.depth === depth) top.n++;
    else open.push({ depth, n: closed ? closed.n + 1 : 1 });
    out.push({
      depth,
      text,
      id: anchorId(text, seen),
      number: open.map((o) => o.n).join("."),
      level: open.length - 1,
    });
  }
  return out;
}

/** The outline as a tree, for a contents list whose branches fold. */
export function outlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const path: OutlineNode[] = [];
  for (const it of items) {
    const node: OutlineNode = { ...it, children: [] };
    path.length = it.level;
    (path[path.length - 1]?.children ?? roots).push(node);
    path.push(node);
  }
  return roots;
}

/**
 * The same numbering the outline uses, applied to the rendered HTML, so a
 * heading's id matches the link that points at it. `numbered` also prints the
 * section number in the heading, which is what the wiki reads by.
 */
export function withAnchors(
  html: string,
  items: OutlineItem[],
  opts: { numbered?: boolean } = {},
): string {
  let i = 0;
  return html.replace(/<(h[1-6])(\s[^>]*)?>/g, (match, tag, attrs) => {
    const item = items[i++];
    if (!item) return match;
    const secno = opts.numbered
      ? `<span class="secno">${item.number}</span> `
      : "";
    return `<${tag}${attrs ?? ""} id="${item.id}">${secno}`;
  });
}
