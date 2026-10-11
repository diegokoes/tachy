import { createHash } from "node:crypto";
import { MAX_ASSET_BYTES } from "@tachy/contract";
import {
  scrubText,
  TokenMap,
  type RedactionPolicy,
} from "../compliance/redaction";
import {
  joinPages,
  openPdf,
  rawImageForModel,
  splitPages,
  type ModelImage,
  type OpenedPdf,
  type RawImage,
} from "../files";
import { saveAsset } from "../library/assets";
import { getReferenceDoc, updateReferenceDoc } from "./reference";

/**
 * Reads the words off a scanned page. Null when it cannot: no model
 * credential resolves for that person. Registered by the package that reaches
 * a model, which core does not.
 */
export type PageTranscriber = (
  page: ModelImage,
  reader: { userId: string | null; docId: string; pageNumber: number },
) => Promise<string | null>;

let transcriber: PageTranscriber | undefined;

export function registerPageTranscriber(transcribe: PageTranscriber): void {
  transcriber = transcribe;
}

/** A picture narrower or shorter than this is a bullet, a rule or an icon. */
const FIGURE_MIN_EDGE_PX = 120;
/** A picture on this many pages is a letterhead, not a figure. */
const DECORATION_MIN_PAGES = 3;
/** Figures kept from one document. */
const FIGURES_MAX = 60;
/** Scanned pages transcribed for one document: each is a model call. */
const SCANNED_PAGES_MAX = 150;

export interface PdfCompletion {
  figures: number;
  transcribed: number;
  /** Scanned pages still without text, and why in `scans_note`. */
  scans_left: number;
  scans_note?: string;
}

interface Figure {
  page: number;
  /** Where the library serves it from. */
  url: string;
  hash: string;
}

const isFigureSized = (image: RawImage) =>
  image.widthPx >= FIGURE_MIN_EDGE_PX && image.heightPx >= FIGURE_MIN_EDGE_PX;

const largest = (images: RawImage[]) =>
  [...images].sort(
    (a, b) => b.widthPx * b.heightPx - a.widthPx * a.heightPx,
  )[0] as RawImage | undefined;

/**
 * The figures on `pages`, each stored as it is met so that only one is held
 * at a time. One that turns out to be a letterhead is left unplaced, and the
 * sweep of unused library images removes it.
 */
async function storeFigures(
  pdf: OpenedPdf,
  pages: number[],
  owner: { title: string; productId: string | null; userId: string | null },
  signal: AbortSignal,
): Promise<Figure[]> {
  const stored: Figure[] = [];
  for (const page of pages) {
    signal.throwIfAborted();
    if (stored.length >= FIGURES_MAX) break;
    for (const raw of (await pdf.imagesOn(page)).filter(isFigureSized)) {
      const image = await rawImageForModel(raw);
      if (image.bytes.length > MAX_ASSET_BYTES) continue;
      const saved = await saveAsset({
        bytes: image.bytes,
        filename: `${owner.title} p${page}`,
        productId: owner.productId,
        createdById: owner.userId,
      });
      const hash = createHash("sha256").update(image.bytes).digest("hex");
      stored.push({ page, url: saved.url, hash });
    }
  }
  const pagesByHash = new Map<string, Set<number>>();
  for (const { hash, page } of stored)
    pagesByHash.set(hash, (pagesByHash.get(hash) ?? new Set()).add(page));
  return stored
    .filter((f) => pagesByHash.get(f.hash)!.size < DECORATION_MIN_PAGES)
    .slice(0, FIGURES_MAX);
}

interface Transcription {
  texts: Map<number, string>;
  left: number;
  note?: string;
}

/**
 * The text of the scanned pages, as far as it can be had. It stops at the
 * first page nobody can read rather than asking for each: the reason is the
 * same for all of them.
 */
async function transcribeScans(
  pdf: OpenedPdf,
  reader: { userId: string | null; docId: string },
  policy: RedactionPolicy,
  signal: AbortSignal,
): Promise<Transcription> {
  const scans = pdf.scannedPages;
  const texts = new Map<number, string>();
  const done = (note?: string): Transcription => ({
    texts,
    left: scans.length - texts.size,
    ...(note && scans.length > texts.size ? { note } : {}),
  });
  if (!scans.length) return done();
  if (!policy.images)
    return done("redaction is on and images are withheld from the model");
  if (!transcriber) return done("this process cannot reach a model");

  const tokens = new TokenMap();
  for (const pageNumber of scans.slice(0, SCANNED_PAGES_MAX)) {
    signal.throwIfAborted();
    const scan = largest(await pdf.imagesOn(pageNumber));
    if (!scan) continue;
    const page = await rawImageForModel(scan);
    const text = await transcriber(page, { ...reader, pageNumber });
    if (text === null) return done("no model credential to read them with");
    const words = text.trim();
    if (words)
      texts.set(pageNumber, policy.enabled ? scrubText(words, tokens) : words);
  }
  return done(
    scans.length > SCANNED_PAGES_MAX
      ? `only the first ${SCANNED_PAGES_MAX} scanned pages are read`
      : "the others hold no picture to read, or no words",
  );
}

const figureMarkdown = (page: number, url: string) =>
  `![Figure on page ${page}](${url})`;

/**
 * Completes a doc saved from a PDF's text layer: its figures, kept as library
 * images under the page they are on, and the words of its scanned pages. One
 * new revision, refused if the doc changed meanwhile so no edit is overwritten.
 */
export async function completeDocFromPdf(input: {
  docId: string;
  pdf: Uint8Array;
  userId: string | null;
  /** The redaction of where the PDF came from: a connection's, or the global one. */
  policy: RedactionPolicy;
  signal: AbortSignal;
}): Promise<PdfCompletion> {
  const doc = await getReferenceDoc(input.docId);
  const pdf = await openPdf(input.pdf);
  const scanned = new Set(pdf.scannedPages);
  const textPages = Array.from({ length: pdf.pages }, (_, i) => i + 1).filter(
    (page) => !scanned.has(page),
  );

  const pagesInBody = new Set(
    splitPages(doc.body as string).map(({ page }) => page),
  );
  const figures = await storeFigures(
    pdf,
    textPages.filter((page) => pagesInBody.has(page)),
    {
      title: doc.title as string,
      productId: doc.product_id as string | null,
      userId: input.userId,
    },
    input.signal,
  );
  const scans = await transcribeScans(
    pdf,
    { userId: input.userId, docId: input.docId },
    input.policy,
    input.signal,
  );

  const additions = new Map<number, string[]>();
  const add = (page: number, text: string) =>
    additions.set(page, [...(additions.get(page) ?? []), text]);
  for (const [page, text] of scans.texts) add(page, text);
  for (const figure of figures)
    add(figure.page, figureMarkdown(figure.page, figure.url));

  const completion: PdfCompletion = {
    figures: figures.length,
    transcribed: [...scans.texts.keys()].filter((p) => pagesInBody.has(p))
      .length,
    scans_left: scans.left,
    ...(scans.note ? { scans_note: scans.note } : {}),
  };
  if (!additions.size) return completion;

  const body = joinPages(
    splitPages(doc.body as string).map(({ page, text }) => ({
      page,
      text: [text, ...((page !== null && additions.get(page)) || [])]
        .filter(Boolean)
        .join("\n\n"),
    })),
  );
  await updateReferenceDoc(
    input.docId,
    { body, expectedVersion: doc.version as number },
    { actor: "ingest", userId: input.userId },
  );
  return completion;
}
