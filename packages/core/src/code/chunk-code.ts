export interface CodeChunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  text: string;
}

const TARGET_LINES = 60;
export const MAX_CHUNK_CHARS = 2400;
const OVERLAP_LINES = 10;
const BOUNDARY_LOOKBACK = 20;

const BOUNDARY_RE =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s|class\s|def\s|func\s|fn\s|impl\s|interface\s|trait\s|struct\s|enum\s|module\s|type\s+\w+\s*=|(public|private|protected|internal)\s|(static\s+)?[A-Za-z_][\w<>,\s[\]]*\s+[A-Za-z_]\w*\s*\()/;

/**
 * Split source code into overlapping line windows, preferring to cut at
 * symbol-boundary lines so definitions stay whole-ish. `maxChars` is what the
 * embedding model reads of one chunk: past it, a chunk's tail is stored and
 * never embedded.
 */
export function chunkCode(
  content: string,
  maxChars = MAX_CHUNK_CHARS,
): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    // As many lines as the budget holds, up to the target. One line longer
    // than the budget is still a chunk: its tail goes unread, but it is found.
    let end = start;
    let size = 0;
    while (end < lines.length && end - start < TARGET_LINES) {
      const next = size + lines[end].length + 1;
      if (next > maxChars && end > start) break;
      size = next;
      end++;
    }

    if (end < lines.length) {
      for (
        let i = end;
        i > end - BOUNDARY_LOOKBACK && i > start + OVERLAP_LINES;
        i--
      ) {
        if (BOUNDARY_RE.test(lines[i])) {
          end = i;
          break;
        }
      }
    }

    const text = lines.slice(start, end).join("\n");
    if (text.trim()) {
      chunks.push({
        ordinal: chunks.length,
        startLine: start + 1,
        endLine: end,
        text,
      });
    }
    if (end >= lines.length) break;
    // A quarter of a short chunk at most: ten lines repeated out of fifteen
    // tripled the chunks of a dense file without adding anything to find.
    const overlap = Math.min(OVERLAP_LINES, Math.floor((end - start) / 4));
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
