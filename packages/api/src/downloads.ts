/** RFC 5987, so a filename with non-ASCII survives the header. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * For bytes that came from outside and are served from this origin: nothing
 * in them is run or guessed at, whatever they turn out to be.
 */
export const INERT_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
