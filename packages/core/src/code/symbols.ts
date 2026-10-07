/**
 * The names a piece of source defines. Search weights them above the body, so
 * asking for a symbol finds where it is defined before the places that use it:
 * a test that calls a function ten times otherwise outranks the function.
 *
 * Shallow: it reads declarations a line at a time across the languages a
 * support team's repos are written in, and a name it misses is still found in
 * the body.
 */
const DECLARATIONS = [
  /(?:^|[\s(])(?:function\*?|class|interface|enum|struct|trait|impl|module|namespace|def|func|fn|type)\s+([A-Za-z_$][\w$]*)/g,
  // Variables only near the left margin: one declared deep inside a function
  // is a local, and every chunk has those.
  /^ {0,2}(?:export\s+)?(?:declare\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/gm,
  /\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|function|index|view|type)\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][\w]*)/gi,
];

const MAX_SYMBOLS = 40;

export function definedSymbols(text: string): string[] {
  const names = new Set<string>();
  for (const re of DECLARATIONS)
    for (const m of text.matchAll(re)) {
      if (m[1].length > 1) names.add(m[1]);
      if (names.size >= MAX_SYMBOLS) return [...names];
    }
  return [...names];
}

/** `packages/web/src/flows/FlowCanvas.svelte` is asked for as "FlowCanvas". */
export function fileStem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.indexOf(".", 1);
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * What a chunk is findable by besides its text: the names it defines, and for
 * a file's first chunk the file's own name, which the text never contains.
 * These become the A-weighted lexemes of code_blob_chunks.search_tsv.
 */
export function chunkSymbols(
  path: string,
  chunk: { ordinal: number; text: string },
): string {
  const names = definedSymbols(chunk.text);
  if (chunk.ordinal === 0) names.unshift(fileStem(path));
  return names.join(" ");
}
