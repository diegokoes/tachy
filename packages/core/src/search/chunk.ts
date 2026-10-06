export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

function hardSplit(text: string, maxChars: number, overlap: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    pieces.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return pieces;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? 800;
  const overlap = opts.overlap ?? 100;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const packed: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      packed.push(current);
      const tail = overlap > 0 ? current.slice(-overlap) : "";
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) packed.push(current);

  return packed.flatMap((c) =>
    c.length <= maxChars * 1.5 ? [c] : hardSplit(c, maxChars, overlap),
  );
}
