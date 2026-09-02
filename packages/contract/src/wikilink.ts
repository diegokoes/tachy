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
  const t = target.trim();
  const shown = (label ?? "").trim() || t;
  const m = /^(entry|doc):(.+)$/i.exec(t);
  if (m)
    return {
      target: t,
      label: shown,
      kind: m[1].toLowerCase() as "entry" | "doc",
      ref: m[2].trim(),
    };
  return { target: t, label: shown, kind: "article", ref: t };
}

/** Every link in a body, in source order, duplicates included. */
export function parseWikilinks(body: string): Wikilink[] {
  const out: Wikilink[] = [];
  for (const m of (body ?? "").matchAll(WIKILINK_RE))
    out.push(parseWikilink(m[1], m[2]));
  return out;
}
