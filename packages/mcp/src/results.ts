import { globalRedactionEnabled, scrubDeep, TokenMap } from "@tachy/core";

/**
 * How a tool answers. Everything here shapes what the model reads back — the
 * redaction, the notes that steer the next call, and the row trimming that keeps
 * a result inside the size ceiling.
 */
export function out(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

/**
 * Tool results have a size ceiling; a whole transcript blows it, so turns ship
 * bounded. Skips what does not fit rather than stopping at it — one long turn
 * early in a ticket used to end the walk, and the model got `shown: 0` on a
 * transcript that had plenty of readable turns after it.
 */

export function outScrubbed(obj: unknown) {
  return out(globalRedactionEnabled() ? scrubDeep(obj, new TokenMap()) : obj);
}

/**
 * Raw cos_sim / fts_rank / trgm_sim / rrf are uninterpretable without knowing
 * each signal's scale, and they cost context on every row. `relevance` (0-1) and
 * `grade` carry the same information in a form the model can act on.
 */
export function forAgent<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map(
    ({
      cos_sim,
      fts_rank,
      trgm_sim,
      rrf,
      customer_id,
      customer_slug,
      ...rest
    }) => ({
      ...rest,
      // One spelling of the customer across all three search surfaces, and the
      // slug rather than the uuid — the uuid is not something to cite or filter by.
      ...(customer_slug ? { customer: customer_slug } : {}),
    }),
  );
}

/**
 * An empty result is an answer. Saying so explicitly stops the model filling the
 * silence with a plausible-sounding recollection.
 */
export const NO_MATCHES =
  "no entries cleared the relevance floor for this query — the archive has nothing on this. Say so rather than inferring an answer.";

/** Calibration for the scores every search returns; shared so the three stay in step. */
export const GRADE_NOTE =
  "Each hit carries relevance (0-1) and grade (strong / good / weak), calibrated against the embedding model's measured distribution: a weak hit is context, not an answer, and saying so beats presenting it as a prior case. Re-running the same search with reworded queries to force a hit is not research.";

/**
 * Fires whenever a result set is not uniformly general. Said once per call, on
 * the results themselves, because attribution is only wrong at the moment the
 * answer is written — and a mixed list is exactly where one install's fix gets
 * retold as how the product behaves.
 */
export const CUSTOMER_NOTE =
  "Some hits carry a `customer`: that material came from one customer's install and must be attributed to them by name — never restated as general product behaviour. Hits with customer null are general. Where the two disagree, say so rather than merging them.";

export function searchOut(rows: Record<string, unknown>[], kind: string) {
  const trimmed = forAgent(rows);
  if (!trimmed.length)
    return outScrubbed({ results: [], note: `${kind}: ${NO_MATCHES}` });
  const scoped = rows.some((r) => r.customer_slug ?? r.customer);
  return outScrubbed(
    scoped ? { results: trimmed, note: CUSTOMER_NOTE } : trimmed,
  );
}
