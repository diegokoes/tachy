export type XmlToken =
  | { kind: "open" | "close" | "empty"; name: string; attributes: string }
  | { kind: "text"; text: string };

/**
 * Declarations, comments and CDATA first, so their content is never read as a
 * tag; then a tag; then the text up to the next one.
 */
const TOKEN =
  /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body] ?? entity;
    const code =
      body[1].toLowerCase() === "x"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  });
}

/**
 * The tags and text of a document in order. Enough for the generated XML an
 * office file holds; it checks nothing a parser would.
 */
export function* xmlTokens(xml: string): Generator<XmlToken> {
  for (const match of xml.matchAll(TOKEN)) {
    const [, cdata, closing, name, attributes, selfClosing, text] = match;
    if (cdata !== undefined) yield { kind: "text", text: cdata };
    else if (text !== undefined)
      yield { kind: "text", text: decodeEntities(text) };
    else if (name === undefined) continue;
    else if (closing) yield { kind: "close", name, attributes: "" };
    else yield { kind: selfClosing ? "empty" : "open", name, attributes };
  }
}

/** An attribute's value, or undefined when the tag does not carry it. */
export function attribute(
  attributes: string,
  name: string,
): string | undefined {
  const value = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(
    attributes,
  )?.[1];
  return value === undefined ? undefined : decodeEntities(value);
}
