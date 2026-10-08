/**
 * The [[wikilink]] syntax, in the contract because both sides parse it: the
 * server extracts edges on save, and the browser renders them. Two parsers that
 * could disagree about what a link is would let a rendered link have no stored
 * edge, or the reverse.
 *
 *   [[spooler-stalls]]                  an article in this wiki
 *   [[spooler-stalls|the spooler]]      with display text
 *   [[entry:<uuid>|SSO loop]]           a knowledge entry
 *   [[doc:<uuid>|The old runbook]]      an imported reference doc
 */
export const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;

export type WikilinkTargetKind = "article" | "entry" | "doc";

export interface Wikilink {
  /** Verbatim text inside the brackets, before any `|`. */
  target: string;
  /** What to show. Falls back to the target when no `|` was given. */
  label: string;
  kind: WikilinkTargetKind;
  /** The part after `entry:` / `doc:`; the slug itself for an article. */
  ref: string;
}

export function parseWikilink(target: string, label?: string): Wikilink {
  const trimmed = target.trim();
  const shown = (label ?? "").trim() || trimmed;
  const typed = /^(entry|doc):(.+)$/i.exec(trimmed);
  if (typed)
    return {
      target: trimmed,
      label: shown,
      kind: typed[1].toLowerCase() as "entry" | "doc",
      ref: typed[2].trim(),
    };
  return { target: trimmed, label: shown, kind: "article", ref: trimmed };
}

/** Every link in a body, in source order, duplicates included. */
export function parseWikilinks(body: string): Wikilink[] {
  const links: Wikilink[] = [];
  for (const match of (body ?? "").matchAll(WIKILINK_RE))
    links.push(parseWikilink(match[1], match[2]));
  return links;
}

/**
 * Point every `[[from]]` / `[[from|label]]` in a body at `to`, keeping labels,
 * so renaming an article carries the links written against it.
 */
export function renameWikilinks(
  body: string,
  from: string,
  to: string,
): string {
  return body.replace(WIKILINK_RE, (raw, target: string, label?: string) =>
    target.trim() === from
      ? `[[${to}${label === undefined ? "" : `|${label}`}]]`
      : raw,
  );
}
