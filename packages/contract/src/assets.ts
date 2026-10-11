/**
 * Images placed in library bodies. The server sniffs and stores them; the SPA
 * offers them to the file picker and decides which `<img>` a body may render.
 *
 * SVG is excluded: it is a document that can carry script, and it would be
 * served from this origin.
 */
export const LIBRARY_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type LibraryAssetType = (typeof LIBRARY_ASSET_TYPES)[number];

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

export const assetPath = (id: string) => `/api/library/assets/${id}`;

/**
 * The only image source a rendered body may load. Anything else is refused
 * rather than fetched: an agent-written article could otherwise embed an image
 * whose URL carries data out, and every reader's browser would request it.
 */
export const ASSET_SRC_RE =
  /^\/api\/library\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const starts = (bytes: Uint8Array, at: number, sig: number[]) =>
  sig.every((b, i) => bytes[at + i] === b);

/**
 * What the bytes are, read from their first few. The upload's own content type
 * is the browser's guess from a file extension, and trusting it is how a page
 * of HTML gets stored and served back as an "image".
 */
export function sniffImage(bytes: Uint8Array): LibraryAssetType | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    starts(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    starts(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  )
    return "image/webp";
  return null;
}
