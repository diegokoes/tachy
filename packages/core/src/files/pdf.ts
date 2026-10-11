import { extractImages, extractText, getDocumentProxy } from "unpdf";
import type { RawImage } from "./image";
import { joinPages } from "./pages";

function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A page whose text layer holds no word: nothing at all, or only the page
 * number a scanner or a stamping tool put there.
 */
const hasNoWords = (text: string) => !/\p{L}{2}/u.test(text);

export interface PdfText {
  /** Each page's text under its page mark. */
  text: string;
  pages: number;
  /** Pages with no text layer: scans, whose words are only in their picture. */
  scannedPages: number[];
}

export interface OpenedPdf extends PdfText {
  /** The pictures placed on a page, as stored: a figure, a logo, or a scan. */
  imagesOn(page: number): Promise<RawImage[]>;
}

/** A PDF parsed once, for a caller that reads its pictures as well as its text. */
export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  // unpdf detaches the buffer it is given, so it gets its own copy.
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(document, {
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
      .filter((page) => hasNoWords(page.text))
      .map((page) => page.page),
    async imagesOn(page) {
      const images = await extractImages(document, page);
      const copies = images.map((image) => ({
        data: Uint8Array.from(image.data),
        widthPx: image.width,
        heightPx: image.height,
        channels: image.channels,
      }));
      // pdf.js keeps every decoded picture of a page it has read. Released
      // here, a document of scans costs one page of memory and not all of them.
      (await document.getPage(page)).cleanup();
      return copies;
    },
  };
}

export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  const { text, pages, scannedPages } = await openPdf(bytes);
  return { text, pages, scannedPages };
}
