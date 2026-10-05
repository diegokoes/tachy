import { GOOD, STRONG, grade } from "@tachy/contract";
import type { Grade } from "@tachy/contract";
import { EMBEDDING_SPEC } from "./model";

export { GOOD, STRONG, grade };
export type { Grade };

/**
 * The vector leg's floor and where real matches top out, for the model in
 * use (EMBEDDING_MODELS in model.ts says how each pair was measured). BAAI
 * document bge's own distribution as "about in the interval [0.6, 1]" and say
 * plainly that "what matters is the relative order of the scores, not the
 * absolute value ... select an appropriate similarity threshold based on the
 * similarity distribution on your data".
 *
 * FLOOR gates the VECTOR LEG ONLY, which is what makes a narrow gap safe: an
 * identifier query like "ECONNREFUSED" has almost no meaning to match, scores
 * below the floor, and is meant to arrive through the trigram and tsvector
 * legs instead. Raising FLOOR therefore costs paraphrase recall and never
 * exact-match recall.
 */
export const SEM_FLOOR = EMBEDDING_SPEC.semFloor;
export const SEM_CEIL = EMBEDDING_SPEC.semCeil;
export const CODE_SEM_FLOOR = EMBEDDING_SPEC.codeSemFloor;

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
  // unrelated - that second case is the entire reason lexical is in the mix.
  return clamp01(0.85 * sem + 0.72 * lex);
}

export const gradeOf = (r: Ranked): Grade => grade(relevance(r));

/**
 * Attach relevance + grade to a search row. Raw signals are not comparable
 * across surfaces - an interleaved knowledge/reference list needs these.
 */
export function withRelevance<T extends Record<string, unknown>>(row: T) {
  const r = relevance(row as Ranked);
  return { ...row, relevance: Number(r.toFixed(4)), grade: grade(r) };
}
