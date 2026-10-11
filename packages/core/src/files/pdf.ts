import { extractText } from "unpdf";

function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A PDF's text layer. A scanned page has none and contributes nothing. */
export async function pdfText(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number }> {
  // unpdf detaches the buffer it is given, so it gets its own copy.
  const { totalPages, text } = await extractText(new Uint8Array(bytes), {
    mergePages: true,
  });
  return { text: normalizeText(text), pages: totalPages };
}
