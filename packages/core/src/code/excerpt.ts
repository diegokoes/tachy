/**
 * What a code search hit shows of its chunk: the lines that hold the query's
 * words, numbered as `readCodeFile` numbers them, so a hit points at its match
 * without carrying the whole chunk.
 */

const MAX_EXCERPT_LINES = 8;
const MAX_EXCERPT_CHARS = 600;
const MAX_LINE_CHARS = 200;
/** Shorter query words (`id`, `ts`) are on most lines and point at none. */
const MIN_WORD_CHARS = 3;

/** The words of identifiers and text, split as `tachy_code_words` in db/schema.sql splits them. */
function codeWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function wordsMatched(line: string, wanted: Set<string>): number {
  return new Set(codeWords(line).filter((word) => wanted.has(word))).size;
}

/**
 * Line indexes in the order they earn a place: the lines matching most of the
 * query first, each followed by its neighbours.
 */
function byPriority(lines: string[], wanted: Set<string>): number[] {
  const anchors = lines
    .map((line, index) => ({ index, matched: wordsMatched(line, wanted) }))
    .filter((anchor) => anchor.matched > 0)
    .sort((a, b) => b.matched - a.matched || a.index - b.index);
  return anchors.flatMap(({ index }) => [index, index - 1, index + 1]);
}

const shortened = (line: string) =>
  line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;

/**
 * A chunk with no line holding a query word, a hit of the vector leg alone,
 * shows its first lines.
 */
export function codeExcerpt(
  chunkText: string,
  startLine: number,
  query: string,
): string {
  const lines = chunkText.split("\n").map((line) => line.trimEnd());
  const wanted = new Set(
    codeWords(query).filter((word) => word.length >= MIN_WORD_CHARS),
  );
  const matched = byPriority(lines, wanted);
  const candidates = matched.length ? matched : lines.map((_, index) => index);

  const chosen = new Map<number, string>();
  let chars = 0;
  for (const index of candidates) {
    if (chosen.size >= MAX_EXCERPT_LINES) break;
    if (chosen.has(index) || !lines[index]?.trim()) continue;
    const row = `${startLine + index}\t${shortened(lines[index])}`;
    if (chosen.size && chars + row.length + 1 > MAX_EXCERPT_CHARS) continue;
    chosen.set(index, row);
    chars += row.length + 1;
  }
  return [...chosen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    .join("\n");
}
