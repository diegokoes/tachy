/**
 * Markup for the private notes tachy writes onto a ticket. A helpdesk renders a
 * note body as HTML with no stylesheet of ours, so every rule is inline.
 */

/**
 * Stamped into every posted transcript. A compacted note becomes a message on
 * the ticket, so without this a second run would compact its own output.
 */
export const TRANSCRIPT_MARKER = "[tachy:compacted-transcript]";

/** Stamped into every posted summary, so the next one can replace it. */
export const SUMMARY_MARKER = "[tachy:summary]";

export const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const INK = "#1a1a1a";
const MUTED = "#777";
const FAINT = "#999";
const HAIRLINE = "#e3e3e3";
const MONO = "Consolas,Menlo,monospace";

export type CardTone = "reply" | "internal_note" | "quoted";

const TONE: Record<CardTone, { accent: string; background: string }> = {
  reply: { accent: "#9aa7b4", background: "#ffffff" },
  internal_note: { accent: "#c98a00", background: "#fff8e6" },
  quoted: { accent: "#8d8db3", background: "#f6f6fa" },
};

const BULLET_LINE = /^\s*[-*•·]\s+(.*)$/;
const NUMBERED_LINE = /^\s*\d{1,3}[.)]\s+(.*)$/;
const INDENTED_LINE = /^(?: {2,}|\t)\S/;
/** Stops at an escaped quote or bracket, which closes the URL in escaped text. */
const URL_IN_ESCAPED_TEXT = /https?:\/\/(?:(?!&quot;|&gt;|&lt;)\S)+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;
const IMAGE_MARK_IN_TEXT = /\[image\]/g;

/** Escapes one run of text, then links its URLs and mutes image placeholders. */
function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(URL_IN_ESCAPED_TEXT, (match) => {
      const url = match.replace(TRAILING_PUNCTUATION, "");
      return `<a href="${url}">${url}</a>${match.slice(url.length)}`;
    })
    .replace(IMAGE_MARK_IN_TEXT, `<span style="color:${FAINT}">[image]</span>`);
}

const preformattedHtml = (paragraph: string) =>
  `<pre style="margin:0 0 8px 0;padding:6px 8px;background:#f4f4f4;border-radius:3px;` +
  `font-family:${MONO};font-size:12px;white-space:pre-wrap;word-break:break-word">${escapeHtml(paragraph)}</pre>`;

type LineKind = "bullet" | "numbered" | "prose";

const lineKind = (line: string): LineKind => {
  if (BULLET_LINE.test(line)) return "bullet";
  if (NUMBERED_LINE.test(line)) return "numbered";
  return "prose";
};

const LIST_TAG = { bullet: "ul", numbered: "ol" } as const;
const LIST_ITEM = { bullet: BULLET_LINE, numbered: NUMBERED_LINE } as const;

function lineRunHtml(kind: LineKind, lines: string[]): string {
  if (kind === "prose")
    return `<p style="margin:0 0 8px 0">${lines.map(inlineHtml).join("<br>")}</p>`;
  const items = lines.map(
    (line) => `<li>${inlineHtml(LIST_ITEM[kind].exec(line)?.[1] ?? line)}</li>`,
  );
  return `<${LIST_TAG[kind]} style="margin:0 0 8px 0;padding-left:22px">${items.join("")}</${LIST_TAG[kind]}>`;
}

/** Consecutive lines of one kind become one paragraph or one list. */
function paragraphHtml(paragraph: string): string {
  const runs: { kind: LineKind; lines: string[] }[] = [];
  for (const line of paragraph.split("\n")) {
    const kind = lineKind(line);
    const last = runs.at(-1);
    if (last?.kind === kind) last.lines.push(line);
    else runs.push({ kind, lines: [line] });
  }
  return runs.map((run) => lineRunHtml(run.kind, run.lines)).join("");
}

export interface TextToHtmlOptions {
  /** Paragraphs to keep in a fixed-width block, e.g. pasted logs or payloads. */
  preformatted?: (paragraph: string) => boolean;
}

/**
 * Plain text as block markup: paragraphs, lists, fixed-width blocks and links.
 * Wording and order are untouched; only the whitespace becomes structure.
 */
export function textToHtml(text: string, opts: TextToHtmlOptions = {}): string {
  return text
    .split(/\n[ \t]*\n/)
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => {
      const fixedWidth =
        opts.preformatted?.(paragraph) ||
        paragraph.split("\n").some((line) => INDENTED_LINE.test(line));
      return fixedWidth
        ? preformattedHtml(paragraph)
        : paragraphHtml(paragraph);
    })
    .join("");
}

const HTML_TAG =
  /<\/?(p|div|br|ul|ol|li|b|i|em|strong|a|span|h[1-6]|table|tr|td|img|pre|code|blockquote)\b/i;

/** A body that is already markup passes through; plain text is formatted. */
export function asNoteHtml(body: string): string {
  return HTML_TAG.test(body) ? body : `<div>${textToHtml(body)}</div>`;
}

export function noteHeader(
  label: string,
  title: string | undefined,
  externalId: string,
): string {
  return (
    `<p style="margin:0 0 8px 0;font-size:15px;color:${INK}"><strong>${escapeHtml(label)}</strong>` +
    ` - ${escapeHtml(title ?? "")} <span style="color:${MUTED}">[#${escapeHtml(externalId)}]</span></p>`
  );
}

export interface StatCell {
  value: string;
  label: string;
}

export function statTable(cells: StatCell[]): string {
  const cellHtml = (cell: StatCell) =>
    `<td style="padding:6px 14px;border:1px solid ${HAIRLINE};text-align:center">` +
    `<strong style="font-size:15px;color:${INK}">${escapeHtml(cell.value)}</strong><br>` +
    `<span style="font-size:11px;color:${MUTED}">${escapeHtml(cell.label)}</span></td>`;
  return `<table style="border-collapse:collapse;margin:0 0 8px 0"><tr>${cells.map(cellHtml).join("")}</tr></table>`;
}

export const mutedLine = (html: string) =>
  `<p style="margin:0 0 8px 0;font-size:12px;color:${MUTED}">${html}</p>`;

export const sectionRule = (label: string, detail = "") =>
  `<p style="margin:16px 0 8px 0;padding:0 0 4px 0;border-bottom:2px solid ${HAIRLINE};color:${INK}">` +
  `<strong>${escapeHtml(label)}</strong>${detail ? ` <span style="font-size:12px;color:${MUTED}">${escapeHtml(detail)}</span>` : ""}</p>`;

export interface NoteCard {
  who: string;
  date: string;
  tone: CardTone;
  /** Short label beside the date, e.g. "internal". */
  badge?: string;
  /** Already markup. */
  bodyHtml: string;
  /** One line naming the files on the message. */
  files?: string;
}

export function card(note: NoteCard): string {
  const { accent, background } = TONE[note.tone];
  const badge = note.badge
    ? ` <span style="padding:1px 6px;border-radius:3px;background:${accent};color:#ffffff;font-size:10px;text-transform:uppercase">${escapeHtml(note.badge)}</span>`
    : "";
  const files = note.files
    ? `<p style="margin:0;font-size:12px;color:${MUTED}">files: ${escapeHtml(note.files)}</p>`
    : "";
  return (
    `<div style="margin:0 0 12px 0;padding:8px 12px 2px 12px;border:1px solid ${HAIRLINE};border-left:3px solid ${accent};border-radius:4px;background:${background}">` +
    `<p style="margin:0 0 6px 0;font-size:12px;color:${MUTED}"><strong style="font-size:13px;color:${INK}">${escapeHtml(note.who)}</strong>` +
    ` &middot; ${escapeHtml(note.date)}${badge}</p>` +
    `${note.bodyHtml}${files}<p style="margin:0 0 6px 0"></p></div>`
  );
}

export const noteFooter = (text: string, marker: string) =>
  `<p style="margin:12px 0 0 0;font-size:11px;color:${FAINT}">${escapeHtml(text)} ${marker}</p>`;

/**
 * Groups blocks into notes of at most `maxChars`, never cutting inside a block.
 * A single block over the limit still travels whole, as its own note.
 */
export function packBlocks(blocks: string[], maxChars: number): string[][] {
  const notes: string[][] = [];
  let pending: string[] = [];
  let pendingChars = 0;
  for (const block of blocks) {
    if (pendingChars + block.length > maxChars && pending.length) {
      notes.push(pending);
      pending = [];
      pendingChars = 0;
    }
    pending.push(block);
    pendingChars += block.length + 1;
  }
  if (pending.length) notes.push(pending);
  return notes;
}
