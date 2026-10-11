/**
 * fzf-style matching for the palette: a term matches when its letters appear
 * in order, and scores by how they land - on word starts, in runs, with few
 * gaps. Case-insensitive.
 */

const MATCH = 16;
const BOUNDARY = 8;
/** On top of BOUNDARY, for the text's very first letter. */
const START = 4;
const CONSECUTIVE = 8;
const GAP_OPEN = 3;
const GAP_STEP = 1;
/** How much a hit in a trail or keyword counts against one in the label. */
const SECONDARY = 0.5;

export type Hit = { score: number; at: number[] };

const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function bonus(text: string, j: number): number {
  if (!word(text[j]) || word(text[j - 1])) return 0;
  return j === 0 ? BOUNDARY + START : BOUNDARY;
}

/**
 * The best placement of `term` in `text`, or null when its letters are not all
 * there in order. `at` lists the indices in `text` that matched.
 */
export function match(term: string, text: string): Hit | null {
  const needle = term.toLowerCase();
  const hay = text.toLowerCase();
  const n = needle.length;
  const m = hay.length;
  if (!n) return { score: 0, at: [] };
  if (n > m) return null;

  // best[i][j]: the top score with needle[i] placed on hay[j]; from[i][j] is
  // where needle[i - 1] sat for it.
  const best = Array.from({ length: n }, () =>
    new Array<number>(m).fill(-Infinity),
  );
  const from = Array.from({ length: n }, () => new Array<number>(m).fill(-1));

  for (let j = 0; j < m; j++)
    if (hay[j] === needle[0]) best[0][j] = MATCH + bonus(hay, j);

  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (hay[j] !== needle[i]) continue;
      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === -Infinity) continue;
        const join =
          k === j - 1 ? CONSECUTIVE : -(GAP_OPEN + (j - k - 2) * GAP_STEP);
        const score = best[i - 1][k] + join + MATCH + bonus(hay, j);
        if (score > best[i][j]) {
          best[i][j] = score;
          from[i][j] = k;
        }
      }
    }
  }

  const last = best[n - 1];
  let end = -1;
  for (let j = 0; j < m; j++)
    if (last[j] > -Infinity && (end < 0 || last[j] > last[end])) end = j;
  if (end < 0) return null;

  const at = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; j = from[i][j], i--) at[i] = j;
  return { score: last[end], at };
}

export type Searchable = {
  id: string;
  label: string;
  trail: string[];
  keywords: string[];
};

export type Ranked<T> = {
  item: T;
  score: number;
  /** Indices into the label that matched, for highlighting. */
  hits: number[];
};

/**
 * A trail or keyword counts only where the term appears whole: scattered, a
 * short term finds its letters in nearly every long word, "go" in
 * "integrations".
 */
function whole(term: string, text: string): number {
  if (!text.toLowerCase().includes(term.toLowerCase())) return -Infinity;
  return match(term, text)?.score ?? -Infinity;
}

/** Scores one item against every term; null when any term finds nowhere to land. */
function score<T extends Searchable>(
  item: T,
  terms: string[],
): Ranked<T> | null {
  let total = 0;
  const hits = new Set<number>();
  for (const term of terms) {
    const inLabel = match(term, item.label);
    const elsewhere = Math.max(
      ...[...item.trail, ...item.keywords].map((text) => whole(term, text)),
    );
    if (!inLabel && elsewhere === -Infinity) return null;
    if (inLabel && inLabel.score >= elsewhere * SECONDARY) {
      total += inLabel.score;
      for (const i of inLabel.at) hits.add(i);
    } else {
      total += elsewhere * SECONDARY;
    }
  }
  return { item, score: total, hits: [...hits].sort((a, b) => a - b) };
}

/**
 * Items that match every word of the query, best first; ties go to the more
 * often picked, then to catalogue order. An empty query keeps every item,
 * most picked first, the way a launcher opens.
 */
export function rank<T extends Searchable>(
  items: T[],
  query: string,
  picks: Record<string, number>,
): Ranked<T>[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const ranked = items
    .map((item, index) => ({ index, hit: score(item, terms) }))
    .filter((r): r is { index: number; hit: Ranked<T> } => r.hit !== null);
  ranked.sort(
    (a, b) =>
      b.hit.score - a.hit.score ||
      (picks[b.hit.item.id] ?? 0) - (picks[a.hit.item.id] ?? 0) ||
      a.index - b.index,
  );
  return ranked.map((r) => r.hit);
}

/** `text` cut into runs that matched and runs that did not, for drawing hits. */
export function runs(
  text: string,
  hits: number[],
): { text: string; hit: boolean }[] {
  const marked = new Set(hits);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = marked.has(i);
    const last = out.at(-1);
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
