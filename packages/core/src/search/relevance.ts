import { GOOD, STRONG, grade } from "@tachy/contract";
import type { Grade } from "@tachy/contract";
import { EMBEDDING_SPEC } from "./model";

export { GOOD, STRONG, grade };
export type { Grade };

/**
 * The vector leg's floor and where real matches top out, for the model in use
 * (`EmbeddingModelSpec.semFloor` says how they are measured). The floor gates
 * the vector leg only: an identifier query such as "ECONNREFUSED" scores under
 * it and arrives through the trigram and tsvector legs, so raising it costs
 * paraphrase recall and never exact-match recall.
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
 * Either arm alone can reach `strong`: a paraphrase that shares no words, or
 * an exact error code in an entry whose prose is otherwise unrelated.
 */
export function relevance(signals: Ranked): number {
  const sem = clamp01(
    ((signals.cos_sim ?? 0) - SEM_FLOOR) / (SEM_CEIL - SEM_FLOOR),
  );
  const lex = clamp01(
    Math.min(signals.fts_rank ?? 0, 1) * 2 + (signals.trgm_sim ?? 0) * 0.8,
  );
  return clamp01(0.85 * sem + 0.72 * lex);
}

export const gradeOf = (r: Ranked): Grade => grade(relevance(r));

/**
 * Attach relevance + grade to a search row. Raw signals are not comparable
 * across surfaces - an interleaved knowledge/reference list needs these.
 */
export function withRelevance<T extends Record<string, unknown>>(row: T) {
  const score = relevance(row as Ranked);
  return { ...row, relevance: Number(score.toFixed(4)), grade: grade(score) };
}
