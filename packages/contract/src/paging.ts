/**
 * The most rows any list or search endpoint returns for one request, whatever
 * limit is asked for. Shared because both sides act on it: the server clamps
 * to it, and the library says "first N" instead of "N" when a page comes back
 * full.
 */
export const MAX_PAGE = 100;
