/**
 * The exact strings in a long text that a keyword search can match where its
 * prose cannot: error codes, identifiers, file names, quoted messages. A long
 * query has too many words for any row to hold them all, and a code it names
 * once is lost in its meaning.
 */

/** Terms one search is given at most, the most frequent first. */
export const MAX_EXACT_TERMS = 12;

const MIN_TERM_CHARS = 3;
const MAX_TERM_CHARS = 64;

/** Parts of these look like terms: redaction placeholders, emails, URLs. */
const NOT_TERMS_RE =
  /\[[A-Z]+_\d+\]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?:\/\/|www\.)\S+/gi;

/** A message in English or German quotes. */
const QUOTED_RE = /"([^"\n]{3,64})"|„([^“”\n]{3,64})[“”]|“([^”\n]{3,64})”/g;

/** A word, with the separators an identifier keeps inside it. */
const TOKEN_RE = /[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_])?/gu;

const VERSION_RE = /^v?\d+(?:\.\d+)+$/i;
/** `2nd`, `16GB`, `500ms`, `10.30Uhr`: a number with its unit. */
const NUMBER_WITH_UNIT_RE = /^\d+(?:[.,]\d+)?\p{L}{1,3}$/u;
const SNAKE_CASE_RE = /[\p{L}\p{N}]_[\p{L}\p{N}]/u;
const INNER_CAPITAL_RE = /\p{Ll}\p{Lu}/u;
const ALL_CAPS_RE = /^\p{Lu}{6,}$/u;

/** Words written in capitals for emphasis, not as codes. */
const SHOUTED = new Set([
  "ACHTUNG",
  "ATTENTION",
  "CLOSED",
  "DRINGEND",
  "FEHLER",
  "HINWEIS",
  "IMPORTANT",
  "PLEASE",
  "PROBLEM",
  "RESOLVED",
  "STATUS",
  "THANKS",
  "UPDATE",
  "URGENT",
  "WARNING",
  "WICHTIG",
]);

/** `System.IO.IOException`, `config.json`; not `e.g` or `z.B`. */
function isDottedName(token: string): boolean {
  const parts = token.split(/[.:]+/);
  return (
    parts.length > 1 &&
    parts.every((part) => part.length >= 2 && /\p{L}/u.test(part))
  );
}

function isTerm(token: string): boolean {
  if (token.length < MIN_TERM_CHARS || token.length > MAX_TERM_CHARS)
    return false;
  if (!/\p{L}/u.test(token)) return false;
  if (VERSION_RE.test(token) || NUMBER_WITH_UNIT_RE.test(token)) return false;
  if (/\p{N}/u.test(token)) return true;
  if (SNAKE_CASE_RE.test(token) || INNER_CAPITAL_RE.test(token)) return true;
  if (isDottedName(token)) return true;
  return ALL_CAPS_RE.test(token) && !SHOUTED.has(token);
}

/**
 * The terms in `text`, each once: the most frequent first, then in the order
 * they appear. A quoted message keeps its quotes, so a search reads it as a
 * phrase.
 */
export function exactTerms(text: string): string[] {
  const clean = text.replace(NOT_TERMS_RE, " ");
  const found: { term: string; at: number }[] = [];
  for (const match of clean.matchAll(QUOTED_RE)) {
    const quoted = (match[1] ?? match[2] ?? match[3]).trim();
    if (quoted.length >= MIN_TERM_CHARS)
      found.push({ term: `"${quoted}"`, at: match.index });
  }
  for (const match of clean.matchAll(TOKEN_RE))
    if (isTerm(match[0])) found.push({ term: match[0], at: match.index });

  const counts = new Map<string, number>();
  for (const { term } of found.sort((a, b) => a.at - b.at))
    counts.set(term, (counts.get(term) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXACT_TERMS)
    .map(([term]) => term);
}

/** The terms as one `websearch_to_tsquery` input that any one of them matches. */
export const keywordQueryOf = (terms: string[]): string => terms.join(" or ");

/**
 * What the keyword legs search: the query's own words, or the exact terms a
 * long query was reduced to. The fuzzy leg matches each text on its own.
 */
export function keywordInputs(
  query: string,
  terms: string[] | undefined,
): { words: string; fuzzy: string[] } {
  if (!terms?.length) return { words: query, fuzzy: [query] };
  return { words: keywordQueryOf(terms), fuzzy: terms };
}
