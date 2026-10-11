export interface TextWindow {
  /** Chars to skip from the start. */
  offset?: number;
  maxChars: number;
  /**
   * Literal terms, matched without case. With any, only the lines holding one
   * are kept, each with the lines around it.
   */
  match?: string[];
}

export interface WindowedText {
  text: string;
  /** Length of what the window was cut from: the whole text, or the matches. */
  chars: number;
  truncated: boolean;
  /** Lines that held a term; absent when no term was asked for. */
  matchedLines?: number;
}

/** Lines shown on each side of a line that holds a term. */
const CONTEXT_LINES = 2;

/**
 * The lines holding a term, in blocks with their context. Each block is headed
 * by the offset it starts at in the whole text, which a later read can pass to
 * see more of that place.
 */
function matchingBlocks(
  text: string,
  terms: string[],
): { text: string; matchedLines: number } {
  const needles = terms.map((term) => term.toLowerCase());
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const blocks: string[] = [];
  let matchedLines = 0;
  let blockStart = -1;
  let blockEnd = -1;
  const closeBlock = () => {
    if (blockStart < 0) return;
    blocks.push(
      `[offset ${lineOffsets[blockStart]}]\n${lines.slice(blockStart, blockEnd + 1).join("\n")}`,
    );
  };
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    if (!needles.some((needle) => lower.includes(needle))) return;
    matchedLines++;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
    if (blockStart >= 0 && from <= blockEnd + 1) {
      blockEnd = to;
      return;
    }
    closeBlock();
    blockStart = from;
    blockEnd = to;
  });
  closeBlock();
  return { text: blocks.join("\n\n"), matchedLines };
}

/** The part of a text a caller asked for: its matches, then offset and length. */
export function windowText(text: string, window: TextWindow): WindowedText {
  const terms = window.match?.filter((term) => term.trim()) ?? [];
  const matched = terms.length ? matchingBlocks(text, terms) : undefined;
  const whole = matched ? matched.text : text;
  const start = Math.min(window.offset ?? 0, whole.length);
  const end = Math.min(start + window.maxChars, whole.length);
  return {
    text: whole.slice(start, end),
    chars: whole.length,
    truncated: end < whole.length,
    ...(matched ? { matchedLines: matched.matchedLines } : {}),
  };
}
