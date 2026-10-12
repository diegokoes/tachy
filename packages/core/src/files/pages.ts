/**
 * Where a page of the source document starts in a text taken from it: a line
 * of its own. A doc saved from a PDF keeps these in its body, which is how a
 * passage found later still knows its page after the body has been edited.
 */
export const pageMark = (page: number) => `[page ${page}]`;

const PAGE_MARK_LINE = /^\[page (\d+)\]$/;

export interface PageText {
  /** Null for text before the first mark, and for a text with none. */
  page: number | null;
  text: string;
}

/** A text by page, in order, without its marks. Pages with no text are kept. */
export function splitPages(text: string): PageText[] {
  const pages: PageText[] = [];
  let page: number | null = null;
  let lines: string[] = [];
  const close = () => {
    const body = lines.join("\n").trim();
    if (body || page !== null) pages.push({ page, text: body });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const mark = PAGE_MARK_LINE.exec(line.trim());
    if (!mark) {
      lines.push(line);
      continue;
    }
    close();
    page = Number(mark[1]);
  }
  close();
  return pages;
}

/** Pages as one text again, each under its mark. */
export const joinPages = (pages: PageText[]) =>
  pages
    .map(({ page, text }) =>
      page === null ? text : [pageMark(page), text].filter(Boolean).join("\n"),
    )
    .join("\n\n");

/**
 * The pages a range such as "7" or "3-12" names, or null when it is not one.
 * Both ends are included.
 */
export function parsePageRange(
  range: string,
): { from: number; to: number } | null {
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(range);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  return from >= 1 && to >= from ? { from, to } : null;
}
