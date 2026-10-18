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

/** Stamped into every note the agent or a flow writes. */
export const NOTE_MARKER = "[tachy:note]";

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
const PANEL = "#f6f7f9";
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

export const preformattedHtml = (text: string) =>
  `<pre style="margin:0 0 8px 0;padding:6px 8px;background:#f4f4f4;border-radius:3px;` +
  `font-family:${MONO};font-size:12px;white-space:pre-wrap;word-break:break-word">${escapeHtml(text)}</pre>`;

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

/** Text split where a blank line separates paragraphs; empty ones dropped. */
export const paragraphsOf = (text: string): string[] =>
  text.split(/\n[ \t]*\n/).filter((paragraph) => paragraph.trim());

/**
 * Plain text as block markup: paragraphs, lists, fixed-width blocks and links.
 * Wording and order are untouched; only the whitespace becomes structure.
 */
export function textToHtml(text: string, opts: TextToHtmlOptions = {}): string {
  return paragraphsOf(text)
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

const ALLOWED_INLINE_TAG = /&lt;(\/?)(b|strong|i|em|code)&gt;/gi;

/** As textToHtml, keeping the bold, italic and code tags the text holds. */
export const richTextToHtml = (text: string): string =>
  textToHtml(text).replace(ALLOWED_INLINE_TAG, "<$1$2>");

const LEADING_BLOCK_TAG = /^\s*<(div|p|table|ul|ol|pre|blockquote|h[1-6])\b/i;

/** A body that opens with block markup passes through; text is formatted. */
export function asNoteHtml(body: string): string {
  return LEADING_BLOCK_TAG.test(body)
    ? body
    : `<div>${richTextToHtml(body)}</div>`;
}

export const mutedText = (text: string) =>
  `<span style="color:${MUTED}">${escapeHtml(text)}</span>`;

export const mutedLine = (text: string) =>
  `<p style="margin:0 0 8px 0;font-size:12px;color:${MUTED}">${escapeHtml(text)}</p>`;

export const noteLink = (href: string, text: string) =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;

export type PillTone = "good" | "warn" | "info" | "bad" | "neutral";

const PILL: Record<PillTone, { background: string; color: string }> = {
  good: { background: "#e2f3e7", color: "#1d6b35" },
  warn: { background: "#fcf0d6", color: "#8a5a00" },
  info: { background: "#e3edfa", color: "#1f4f8f" },
  bad: { background: "#fbe3e3", color: "#9b2222" },
  neutral: { background: "#eceef1", color: "#3c4450" },
};

export function pill(text: string, tone: PillTone): string {
  const { background, color } = PILL[tone];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:${background};color:${color};font-size:12px;font-weight:bold;white-space:nowrap">${escapeHtml(text)}</span>`;
}

const ROW_CELL = `padding:5px 10px 5px 0;vertical-align:top;border-bottom:1px solid #f0f1f3`;

/** A full-width table, one row per entry; cells are already markup. */
export function rowsTable(rows: string[][]): string {
  const rowHtml = (cells: string[]) =>
    `<tr>${cells.map((cell) => `<td style="${ROW_CELL}">${cell}</td>`).join("")}</tr>`;
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 8px 0">${rows.map(rowHtml).join("")}</table>`;
}

export type NoteKind = "summary" | "transcript" | "analysis";

interface NoteStyle {
  label: string;
  color: string;
  tint: string;
  edge: string;
  marker: string;
}

const NOTE_STYLE: Record<NoteKind, NoteStyle> = {
  summary: {
    label: "Summary",
    color: "#2b5f9e",
    tint: "#eef3fa",
    edge: "#cfdcee",
    marker: SUMMARY_MARKER,
  },
  transcript: {
    label: "Transcript",
    color: "#55606e",
    tint: "#f1f3f5",
    edge: "#dde1e6",
    marker: TRANSCRIPT_MARKER,
  },
  analysis: {
    label: "Analysis",
    color: "#6a4c9c",
    tint: "#f3effa",
    edge: "#ddd3ee",
    marker: NOTE_MARKER,
  },
};

/** A label and a value of the strip under the banner; the value is markup. */
export interface NoteFact {
  label: string;
  html: string;
}

/** A boxed line before the sections, e.g. the next step; `html` is markup. */
export interface NoteCallout {
  label: string;
  html: string;
}

export interface NoteSection {
  label?: string;
  /** Shown muted beside the label. */
  detail?: string;
  html: string;
}

export interface NoteDoc {
  kind: NoteKind;
  externalId: string;
  title?: string;
  /** Who asked for the note, e.g. "Ana Ruiz in chat" or "Flow: Triage". */
  requestedBy?: string;
  facts?: NoteFact[];
  callouts?: NoteCallout[];
  sections: NoteSection[];
  caveat?: string;
  /** For a note posted as one of a series. */
  part?: { index: number; total: number };
}

function noteBanner(doc: NoteDoc, style: NoteStyle): string {
  const chip = `<span style="display:inline-block;padding:2px 7px;margin:0 7px 0 0;border-radius:3px;background:${style.color};color:#ffffff;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;vertical-align:2px">${style.label}</span>`;
  const title = doc.title ? `<strong>${escapeHtml(doc.title)}</strong> ` : "";
  const byline = [
    doc.requestedBy,
    doc.part && `part ${doc.part.index}/${doc.part.total}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const bylineRow = byline
    ? `<tr><td style="padding:0;font-size:12px;color:${MUTED}">${escapeHtml(byline)}</td></tr>`
    : "";
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 12px 0;border-top:3px solid ${style.color}">` +
    `<tr><td style="padding:9px 0 2px 0;font-size:15px;color:${INK}">${chip}${title}<span style="color:${MUTED}">#${escapeHtml(doc.externalId)}</span></td></tr>` +
    `${bylineRow}</table>`
  );
}

function factsStrip(facts: NoteFact[]): string {
  const cells = facts.map(
    (fact, index) =>
      `<td style="padding:8px 12px;vertical-align:top;${index ? `border-left:1px solid ${HAIRLINE};` : ""}">` +
      `<div style="font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;margin:0 0 3px 0">${escapeHtml(fact.label)}</div>` +
      `<div style="font-size:13px;color:${INK}">${fact.html}</div></td>`,
  );
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 12px 0;background:${PANEL};border:1px solid ${HAIRLINE}"><tr>${cells.join("")}</tr></table>`;
}

const calloutBox = (callout: NoteCallout, style: NoteStyle) =>
  `<div style="margin:0 0 10px 0;padding:9px 12px;background:${style.tint};border:1px solid ${style.edge};border-radius:4px;color:${INK}">` +
  `<strong>${escapeHtml(callout.label)}:</strong> ${callout.html}</div>`;

/** A section's heading, for a body that places its own headings. */
export function sectionLabel(
  kind: NoteKind,
  label: string,
  detail?: string,
): string {
  const detailHtml = detail
    ? ` <span style="font-weight:normal;letter-spacing:0;text-transform:none;color:${MUTED}">${escapeHtml(detail)}</span>`
    : "";
  return `<p style="margin:16px 0 6px 0;padding:0 0 4px 0;border-bottom:1px solid ${HAIRLINE};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${NOTE_STYLE[kind].color}">${escapeHtml(label)}${detailHtml}</p>`;
}

const noteFooter = (caveat: string, marker: string) =>
  `<table style="width:100%;border-collapse:collapse;margin:14px 0 0 0;border-top:1px solid ${HAIRLINE}"><tr>` +
  `<td style="padding:6px 10px 0 0;font-size:11px;color:${FAINT}">${escapeHtml(caveat)}</td>` +
  `<td style="padding:6px 0 0 0;font-size:11px;color:${FAINT};text-align:right;white-space:nowrap">Generated by tachy ${marker}</td></tr></table>`;

/** One note body: banner, facts, callouts, sections, then the marked footer. */
export function renderNote(doc: NoteDoc): string {
  const style = NOTE_STYLE[doc.kind];
  const blocks = [noteBanner(doc, style)];
  if (doc.facts?.length) blocks.push(factsStrip(doc.facts));
  for (const callout of doc.callouts ?? [])
    blocks.push(calloutBox(callout, style));
  for (const section of doc.sections) {
    const heading = section.label
      ? sectionLabel(doc.kind, section.label, section.detail)
      : "";
    blocks.push(heading + section.html);
  }
  blocks.push(noteFooter(doc.caveat ?? "", style.marker));
  return `<div style="font-size:13px;line-height:1.5;color:${INK}">${blocks.join("\n")}</div>`;
}

export interface NoteCard {
  who: string;
  date: string;
  tone: CardTone;
  /** Short label beside the date, e.g. "internal". */
  badge?: string;
  /** Where the card sits in its series, e.g. "3 of 9". */
  position?: string;
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
  const position = note.position
    ? `<td style="padding:0;font-size:11px;color:${FAINT};text-align:right;white-space:nowrap">${escapeHtml(note.position)}</td>`
    : "";
  const files = note.files
    ? `<p style="margin:0;font-size:12px;color:${MUTED}">files: ${escapeHtml(note.files)}</p>`
    : "";
  return (
    `<div style="margin:0 0 12px 0;padding:8px 12px 2px 12px;border:1px solid ${HAIRLINE};border-left:3px solid ${accent};border-radius:4px;background:${background}">` +
    `<table style="width:100%;border-collapse:collapse;margin:0 0 6px 0"><tr><td style="padding:0;font-size:12px;color:${MUTED}"><strong style="font-size:13px;color:${INK}">${escapeHtml(note.who)}</strong>` +
    ` &middot; ${escapeHtml(note.date)}${badge}</td>${position}</tr></table>` +
    `${note.bodyHtml}${files}<p style="margin:0 0 6px 0"></p></div>`
  );
}

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
