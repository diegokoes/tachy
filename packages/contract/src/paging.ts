/**
 * The most rows any list or search endpoint will return for one request, no
 * matter what limit is asked for. Shared because both sides act on it: the
 * server clamps to it, and the library has to say "first N" rather than "N"
 * once a page comes back full — a truncated list that counts itself is a list
 * that lies about how much there is.
 */
export const MAX_PAGE = 100;
