/**
 * How a tool answers. Everything here shapes what the model reads back: the
 * redaction, the notes that steer the next call, and the row trimming that
 * keeps a result inside the size ceiling.
 */
import {
  globalRedactionEnabled,
  scrubDeep,
  scrubText,
  TokenMap,
} from "@tachy/core/compliance";
import {
  windowText,
  type ModelImage,
  type TextWindow,
} from "@tachy/core/files";

export function out(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/** Said with any text that went through the scrubber. */
export const PLACEHOLDER_NOTE =
  "Placeholders like [EMAIL_1]/[SECRET_1] are intentional redactions - treat them as opaque, never guess the originals.";

/**
 * A text as a read returns it: the part asked for, scrubbed under redaction,
 * which a file off a ticket takes from its connection. `continue_at` is the
 * offset the next read takes when this one was cut. Sources read in one call
 * share `tokens`, so a value keeps its placeholder.
 */
export function shownText(
  text: string,
  window: TextWindow,
  tokens = new TokenMap(),
  redact = globalRedactionEnabled(),
) {
  const shown = windowText(text, window);
  return {
    chars: shown.chars,
    ...(shown.matchedLines != null
      ? { matched_lines: shown.matchedLines }
      : {}),
    truncated: shown.truncated,
    text: redact ? scrubText(shown.text, tokens) : shown.text,
    ...(shown.truncated
      ? { continue_at: (window.offset ?? 0) + shown.text.length }
      : {}),
  };
}

/**
 * What a read says of a PDF: its page count, and the pages whose text is not
 * in the result because they hold none. Empty for any other file.
 */
export function pageFacts(extracted: {
  pages?: number;
  scannedPages?: number[];
}): Record<string, unknown> {
  if (extracted.pages == null) return {};
  if (!extracted.scannedPages?.length) return { pages: extracted.pages };
  return {
    pages: extracted.pages,
    scanned_pages: extracted.scannedPages,
    pages_note:
      "The text carries a [page N] line where each page starts: cite the page. scanned_pages hold no text layer (a scan, or a blank page), so what they say is not in this text; do not infer it.",
  };
}

/**
 * `out`, followed by pictures for the model to look at. Each is its own image
 * block, which is the only form in which a model sees one.
 */
export function outWithImages(payload: unknown, images: ModelImage[]) {
  return {
    content: [
      ...out(payload).content,
      ...images.map((image) => ({
        type: "image" as const,
        data: Buffer.from(image.bytes).toString("base64"),
        mimeType: image.mimeType,
      })),
    ],
  };
}

/**
 * Said where an image would have been, under redaction. The model then knows
 * a picture exists and that asking for it again changes nothing.
 */
export const IMAGE_WITHHELD =
  "This is an image, and it was withheld: PII redaction is on and a picture cannot be scrubbed. Say so, and ask the user to describe what it shows. An administrator can allow images under redaction.";

export function outScrubbed(payload: unknown) {
  return out(
    globalRedactionEnabled() ? scrubDeep(payload, new TokenMap()) : payload,
  );
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
      // One spelling of the customer across all three search surfaces: the
      // slug, which can be cited and filtered by, where the uuid cannot.
      ...(customer_slug ? { customer: customer_slug } : {}),
    }),
  );
}

/**
 * Said on an empty result, so the model does not fill the silence with a
 * recollection.
 */
export const NO_MATCHES =
  "no entries cleared the relevance floor for this query - the archive has nothing on this. Say so rather than inferring an answer.";

/**
 * Calibration for the scores every search returns, shared so the three stay
 * in step.
 */
export const GRADE_NOTE =
  "Each hit carries relevance (0-1) and grade (strong / good / weak), calibrated against the embedding model's measured distribution: a weak hit is context, not an answer, and saying so beats presenting it as a prior case. Re-running the same search with reworded queries to force a hit is not research.";

/**
 * Attached when any hit belongs to a customer. Said once per call, on the
 * results: a mixed list is where one install's fix gets retold as how the
 * product behaves.
 */
export const CUSTOMER_NOTE =
  "Some hits carry a `customer`: that material came from one customer's install and must be attributed to them by name - never restated as general product behaviour. Hits with customer null are general. Where the two disagree, say so rather than merging them.";

export function searchOut(rows: Record<string, unknown>[], kind: string) {
  const trimmed = forAgent(rows);
  if (!trimmed.length)
    return outScrubbed({ results: [], note: `${kind}: ${NO_MATCHES}` });
  const scoped = rows.some((r) => r.customer_slug ?? r.customer);
  return outScrubbed(
    scoped ? { results: trimmed, note: CUSTOMER_NOTE } : trimmed,
  );
}
