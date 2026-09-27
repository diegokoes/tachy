/**
 * Images placed in library bodies. The server sniffs and stores them; the SPA
 * offers them to the file picker and decides which `<img>` a body may render.
 *
 * SVG is absent on purpose: it is a document that can carry script, not a
 * picture, and it would be served from this origin.
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
