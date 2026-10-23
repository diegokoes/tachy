import { chunkText } from "./chunk";
import { EMBEDDING_SPEC } from "./model";

/**
 * Windows one search embeds at most. Each is a forward pass of its own, about
 * a second on the laptop, and other searches wait behind it.
 */
export const MAX_QUERY_WINDOWS = 8;

/**
 * A text longer than the model reads, as the windows a search embeds, in
 * order. A window is as long as the code chunk the model reads whole, the
 * densest text a ticket carries; `chunkText` keeps a paragraph of up to half
 * that again whole, which prose still fits. Past the cap the first window
 * stays, where a ticket states its problem, and the latest, where it stands.
 */
export function queryWindows(text: string): string[] {
  const windows = chunkText(text, { maxChars: EMBEDDING_SPEC.codeChunkChars });
  if (windows.length <= MAX_QUERY_WINDOWS) return windows;
  return [windows[0], ...windows.slice(-(MAX_QUERY_WINDOWS - 1))];
}
