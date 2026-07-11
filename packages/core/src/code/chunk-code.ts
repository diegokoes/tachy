export interface CodeChunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  text: string;
}

const TARGET_LINES = 60;
const MAX_CHARS = 2400;
const OVERLAP_LINES = 10;
const BOUNDARY_LOOKBACK = 20;

const BOUNDARY_RE =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(function\s|class\s|def\s|func\s|fn\s|impl\s|interface\s|trait\s|struct\s|enum\s|module\s|type\s+\w+\s*=|(public|private|protected|internal)\s|(static\s+)?[A-Za-z_][\w<>,\s[\]]*\s+[A-Za-z_]\w*\s*\()/;

/** Split source code into overlapping line windows, preferring to cut at
 * symbol-boundary lines so definitions stay whole-ish. */
export function chunkCode(content: string): CodeChunk[] {
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    let end = Math.min(start + TARGET_LINES, lines.length);

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

    let text = lines.slice(start, end).join("\n");
    while (text.length > MAX_CHARS && end - start > 5) {
      end = start + Math.max(5, Math.floor((end - start) / 2));
      text = lines.slice(start, end).join("\n");
    }

    if (text.trim()) {
      chunks.push({
        ordinal: chunks.length,
        startLine: start + 1,
        endLine: end,
        text,
      });
    }
    if (end >= lines.length) break;
    start = Math.max(end - OVERLAP_LINES, start + 1);
  }
  return chunks;
}
