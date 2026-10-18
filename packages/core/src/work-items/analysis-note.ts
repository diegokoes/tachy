import {
  escapeHtml,
  mutedLine,
  noteLink,
  paragraphsOf,
  preformattedHtml,
  renderNote,
  richTextToHtml,
  type NoteSection,
} from "./note-html";

/** A range of code a note cites, already read at `commit`. */
export interface CitedCode {
  repo: string;
  path: string;
  commit: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** The repo host's page for those lines; null where tachy cannot build one. */
  url: string | null;
  /** The cited lines as they read at `commit`. */
  excerpt: string;
}

export interface AnalysisNote {
  externalId: string;
  title: string;
  /** Plain text; `[[n]]` cites the n-th entry of `code`. */
  body: string;
  code?: CitedCode[];
  requestedBy?: string;
  caveat: string;
}

/** A leading space is kept with the citation so a dropped one leaves none. */
const CITATION = / ?\[\[(\d+)\]\]/g;
const SHORT_SHA_LENGTH = 7;

function lineSpan(code: CitedCode): string {
  return code.startLine === code.endLine
    ? `line ${code.startLine}`
    : `lines ${code.startLine}–${code.endLine}`;
}

function citationHtml(code: CitedCode): string {
  const fileName = code.path.split("/").at(-1) ?? code.path;
  if (code.url) return noteLink(code.url, `${fileName}, ${lineSpan(code)}`);
  const commit = code.commit.slice(0, SHORT_SHA_LENGTH);
  return `<code>${escapeHtml(`${code.path} ${lineSpan(code)} @ ${commit}`)}</code>`;
}

const excerptHtml = (code: CitedCode) =>
  preformattedHtml(code.excerpt) +
  mutedLine(
    `${code.repo}: ${code.path} @ ${code.commit.slice(0, SHORT_SHA_LENGTH)}`,
  );

/**
 * An analysis as one private-note body. Each citation becomes an inline link,
 * the cited lines follow the paragraph that first cites them, and code the
 * text never cites closes the note.
 */
export function renderAnalysisNote(note: AnalysisNote): string {
  const code = note.code ?? [];
  const quoted = new Set<number>();
  const bodyBlocks: string[] = [];
  for (const paragraph of paragraphsOf(note.body)) {
    const citedHere: number[] = [];
    const html = richTextToHtml(paragraph).replace(
      CITATION,
      (match, number: string) => {
        const index = Number(number) - 1;
        const cited = code[index];
        if (!cited) return "";
        citedHere.push(index);
        return (match.startsWith(" ") ? " " : "") + citationHtml(cited);
      },
    );
    bodyBlocks.push(html);
    for (const index of citedHere) {
      if (quoted.has(index)) continue;
      quoted.add(index);
      bodyBlocks.push(excerptHtml(code[index]));
    }
  }
  const sections: NoteSection[] = [{ html: bodyBlocks.join("") }];
  const uncited = code.filter((_, index) => !quoted.has(index));
  if (uncited.length)
    sections.push({
      label: "Code",
      html: uncited
        .map(
          (cited) =>
            `<p style="margin:0 0 4px 0">${citationHtml(cited)}</p>${excerptHtml(cited)}`,
        )
        .join(""),
    });
  return renderNote({
    kind: "analysis",
    externalId: note.externalId,
    title: note.title,
    requestedBy: note.requestedBy,
    sections,
    caveat: note.caveat,
  });
}
