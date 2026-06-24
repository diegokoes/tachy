// Split a long document into overlapping windows small enough to embed well.
// all-MiniLM-L6-v2 truncates at ~256 tokens (~1000 chars), so we target ~800
// chars and prefer paragraph boundaries, with a little overlap so a fact split
// across a boundary still appears whole in at least one chunk.

export interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

function hardSplit(text: string, maxChars: number, overlap: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    out.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = opts.maxChars ?? 800;
  const overlap = opts.overlap ?? 100;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const packed: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      packed.push(cur);
      const tail = overlap > 0 ? cur.slice(-overlap) : "";
      cur = tail ? `${tail}\n\n${p}` : p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur.trim()) packed.push(cur);

  // A single oversized paragraph won't have been broken up above — hard-split it.
  return packed.flatMap((c) => (c.length <= maxChars * 1.5 ? [c] : hardSplit(c, maxChars, overlap)));
}
