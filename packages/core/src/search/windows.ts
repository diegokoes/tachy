import { chunkText } from "./chunk";
import { EMBEDDING_SPEC } from "./model";

/**
 * Characters one search embeds at most. Model time follows the text's length,
 * not how it is cut: this is about 8 s on the laptop, and other searches wait
 * behind each window of it.
 */
export const MAX_QUERY_CHARS = 8 * EMBEDDING_SPEC.codeChunkChars;

/** Windows one search embeds at most; each is an index scan per surface. */
export const MAX_QUERY_WINDOWS = 16;

/** A message under this ("thanks", "any news?") joins the window before it. */
const MIN_WINDOW_CHARS = 80;

/**
 * A thread as the windows a search embeds, one per message, so a symptom one
 * message states is not averaged with the replies around it. A message longer
 * than the model reads whole is cut. Past the budget the first window stays,
 * where a ticket states its problem, and the latest, where it stands.
 */
export function queryWindows(messages: string[]): string[] {
  const windowChars = EMBEDDING_SPEC.codeChunkChars;
  const windows: string[] = [];
  for (const piece of messages.flatMap((message) =>
    chunkText(message, { maxChars: windowChars, overlap: 0 }),
  )) {
    const previous = windows.at(-1);
    if (
      previous !== undefined &&
      piece.length < MIN_WINDOW_CHARS &&
      previous.length + piece.length + 2 <= windowChars
    )
      windows[windows.length - 1] = `${previous}\n\n${piece}`;
    else windows.push(piece);
  }
  return withinBudget(windows);
}

function withinBudget(windows: string[]): string[] {
  const [first, ...later] = windows;
  if (first === undefined) return [];
  const latest: string[] = [];
  let chars = first.length;
  for (let i = later.length - 1; i >= 0; i--) {
    if (latest.length + 1 >= MAX_QUERY_WINDOWS) break;
    if (chars + later[i].length > MAX_QUERY_CHARS) break;
    chars += later[i].length;
    latest.unshift(later[i]);
  }
  return [first, ...latest];
}
