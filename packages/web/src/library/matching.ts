/**
 * Which parts of a hit's text to show on a library card. Match strength is not
 * computed here: the server returns `relevance` (0-1) and `grade`, the numbers
 * the MCP tools hand the agent, and a second copy of that arithmetic would
 * drift on the next model change. The band edges the gauge draws its tick marks
 * at come from @tachy/contract.
 */

export { GOOD, STRONG } from "@tachy/contract";

export type Seg = { t: string; hit?: boolean };

/** Words worth centring an excerpt on - noise words are too short to matter. */
export const terms = (q: string) => [
  ...new Set(q.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []),
];

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;

/** Nudges a cut to the nearest word boundary, so fragments start on words. */
const snapStart = (text: string, i: number) => {
  if (i <= 0) return 0;
  const space = text.indexOf(" ", i);
  return space === -1 || space - i > 12 ? i : space + 1;
};
const snapEnd = (text: string, i: number, min: number) => {
  if (i >= text.length) return text.length;
  const space = text.lastIndexOf(" ", i);
  return space > min ? space : i;
};

/**
 * Wiki-style preview: up to `max` short fragments taken around the query's
 * hits and joined with an ellipsis, rather than one long slab starting wherever
 * the first hit happened to be. Falls back to the head of the text when the
 * match was purely semantic.
 */
export function excerpt(
  text: string,
  query: string,
  frag = 72,
  max = 3,
): Seg[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const ts = terms(query);
  const head = () => [{ t: clip(clean, frag * 2) }];
  if (!ts.length) return head();

  const lower = clean.toLowerCase();
  const hits: [number, number][] = [];
  for (const term of ts) {
    for (
      let i = lower.indexOf(term);
      i !== -1;
      i = lower.indexOf(term, i + term.length)
    )
      hits.push([i, i + term.length]);
  }
  if (!hits.length) return head();
  hits.sort((a, b) => a[0] - b[0]);

  // Greedy windows: each fragment opens a quarter-width before its first
  // unclaimed hit and swallows every hit it can still reach.
  const windows: [number, number][] = [];
  let h = 0;
  while (h < hits.length && windows.length < max) {
    const start = snapStart(
      clean,
      Math.max(0, hits[h][0] - Math.round(frag / 4)),
    );
    const end = snapEnd(
      clean,
      Math.min(clean.length, start + frag),
      start + frag * 0.6,
    );
    windows.push([start, end]);
    while (h < hits.length && hits[h][0] < end) h++;
  }

  const segs: Seg[] = [];
  windows.forEach(([start, end], w) => {
    if (start > 0 || w > 0) segs.push({ t: w === 0 ? "…" : " … " });
    let cursor = start;
    for (const [hitStart, hitEnd] of hits) {
      if (hitEnd <= cursor || hitStart >= end) continue;
      const from = Math.max(hitStart, cursor);
      if (from > cursor) segs.push({ t: clean.slice(cursor, from) });
      segs.push({ t: clean.slice(from, Math.min(hitEnd, end)), hit: true });
      cursor = Math.min(hitEnd, end);
    }
    if (cursor < end) segs.push({ t: clean.slice(cursor, end) });
    if (w === windows.length - 1 && end < clean.length) segs.push({ t: "…" });
  });
  return segs;
}

/** The entry field the query landed in: root cause, else the fix. */
export function entryText(
  fields: (string | null | undefined)[],
  query: string,
) {
  const present = fields.filter((f): f is string => !!f?.trim());
  if (!present.length) return undefined;
  const ts = terms(query);
  if (!ts.length) return present[0];
  const hits = (field: string) => {
    const lowered = field.toLowerCase();
    return ts.reduce((n, t) => n + (lowered.includes(t) ? 1 : 0), 0);
  };
  return [...present].sort((a, b) => hits(b) - hits(a))[0];
}
