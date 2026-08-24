import { GOOD, STRONG, grade } from "@tachy/contract";
import type { Grade } from "@tachy/contract";

export { GOOD, STRONG, grade };
export type { Grade };

/**
 * Raw cosine is not a relevance percentage, and it never starts at zero.
 * Contrastively-trained embedding models compress their similarity range: BAAI
 * document bge's own distribution as "about in the interval [0.6, 1]" and say
 * plainly that "what matters is the relative order of the scores, not the
 * absolute value ... select an appropriate similarity threshold based on the
 * similarity distribution on your data".
 *
 * So the numbers below are measurements, not opinions, and `scripts/eval-embeddings.ts`
 * re-derives them. `test/search-quality.test.ts` asserts them, so changing
 * TACHY_EMBED_MODEL fails the build instead of silently skewing every gauge.
 *
 * Measured for Xenova/bge-base-en-v1.5 over the golden corpus:
 *
 *   nonsense ("ñ", "zzzzzz", "asdfgh", "...")   <= 0.567
 *   genuine paraphrase/resolution matches       >= 0.654, topping out at 0.720
 *
 * FLOOR sits in that gap; CEIL is where real matches actually top out, so a
 * strong paraphrase can still reach the top of the scale. FLOOR gates the
 * VECTOR LEG ONLY, which is what makes a gap this narrow safe: an identifier
 * query like "ECONNREFUSED" scores only ~0.56 semantically — below the floor —
 * and is meant to arrive through the trigram and tsvector legs instead. Raising
 * FLOOR therefore costs paraphrase recall and never exact-match recall.
 */
export const SEM_FLOOR = 0.6;
export const SEM_CEIL = 0.75;

export interface Ranked {
  cos_sim?: number | null;
  fts_rank?: number | null;
  trgm_sim?: number | null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Meaning alone can reach `strong`; words alone can reach `good`, so an exact
 * error-code hit on an otherwise unrelated entry still surfaces.
 */
export function relevance(r: Ranked): number {
  const sem = clamp01(((r.cos_sim ?? 0) - SEM_FLOOR) / (SEM_CEIL - SEM_FLOOR));
  const lex = clamp01(
    Math.min(r.fts_rank ?? 0, 1) * 2 + (r.trgm_sim ?? 0) * 0.8,
  );
  // Either arm can reach STRONG alone. A paraphrase nobody worded the same way
  // is a real hit; so is a bare error code in an entry whose prose is otherwise
  // unrelated — that second case is the entire reason lexical is in the mix.
  return clamp01(0.85 * sem + 0.72 * lex);
}

export const gradeOf = (r: Ranked): Grade => grade(relevance(r));

/**
 * Attach relevance + grade to a search row. Raw signals are not comparable
 * across surfaces — an interleaved knowledge/reference list needs these.
 */
export function withRelevance<T extends Record<string, unknown>>(row: T) {
  const r = relevance(row as Ranked);
  return { ...row, relevance: Number(r.toFixed(4)), grade: grade(r) };
}
