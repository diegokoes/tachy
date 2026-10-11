import { extractText } from "unpdf";
import { joinPages } from "./pages";

function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A page whose text layer holds fewer chars than this is a scan. */
const SCANNED_PAGE_MAX_CHARS = 16;

export interface PdfText {
  /** Each page's text under its page mark. */
  text: string;
  pages: number;
  /** Pages with no text layer: scans, whose words are only in their picture. */
  scannedPages: number[];
}

export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  // unpdf detaches the buffer it is given, so it gets its own copy.
  const { totalPages, text } = await extractText(new Uint8Array(bytes), {
    mergePages: false,
  });
  const pages = text.map((pageText, index) => ({
    page: index + 1,
    text: normalizeText(pageText),
  }));
  return {
    text: joinPages(pages),
    pages: totalPages,
    scannedPages: pages
      .filter((page) => page.text.length < SCANNED_PAGE_MAX_CHARS)
      .map((page) => page.page),
  };
}
