/**
 * Attached files: reading one as what it is, an image to look at or its text,
 * and keeping an image from one in the library.
 */
import { z } from "zod";
import { TokenMap } from "@tachy/core/compliance";
import { MAX_ASSET_BYTES, parseAttachmentRef } from "@tachy/core";
import { resolveCurrentUserId } from "@tachy/core/access";
import {
  extractFile,
  imageForModel,
  imageWithin,
  isImageFile,
  joinPages,
  parsePageRange,
  splitPages,
  type ExtractedFile,
} from "@tachy/core/files";
import { badInput } from "@tachy/core/infra";
import { saveAsset } from "@tachy/core/library";
import { resolveScopeIds } from "../context";
import { requireCanEdit } from "../permissions";
import { openSource } from "../extract";
import { memberField, textWindowFields } from "../fields";
import {
  imageWithheld,
  PLACEHOLDER_NOTE,
  out,
  outWithImages,
  pageFacts,
  shownText,
} from "../results";
import { tool } from "../server";

/** What `read_file` returns of a text when `max_chars` is not given. */
const DEFAULT_READ_CHARS = 20_000;

/**
 * The text of the pages a range names, still under their page marks. Only a
 * PDF has pages.
 */
function pagesOf(extracted: ExtractedFile, range: string): string {
  if (extracted.pages == null)
    throw badInput("pages applies to a PDF; this file has none");
  const wanted = parsePageRange(range);
  if (!wanted)
    throw badInput(
      `'${range}' is not a page or a range of pages, e.g. 7 or 3-12`,
    );
  if (wanted.from > extracted.pages)
    throw badInput(`the PDF has ${extracted.pages} pages`);
  return joinPages(
    splitPages(extracted.text).filter(
      ({ page }) => page !== null && page >= wanted.from && page <= wanted.to,
    ),
  );
}

tool(
  "read_file",
  {
    description:
      "Read one file by its reference: one the user attached (upload:...), or one a ticket lists (the path of an entry in a work item's files). An image comes back as the image itself, for you to look at: a screenshot of an error, a photo of a label. PDF, Word, Excel, mail (.eml) and text files come back as text, truncated at max_chars (default 20000): continue with offset, narrow a log with match, or take a PDF by pages. A zip answers with its file list, and member reads one of them. Open what bears on the question, not everything attached: an image costs about as much context as several pages of text. This tool only reads. To file a document in the library, use ingest_context.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "The reference, exactly as given: upload:... from the message, or the path of a ticket's file.",
        ),
      ...textWindowFields,
      pages: z
        .string()
        .optional()
        .describe("Of a PDF: one page or a range, e.g. 7 or 3-12."),
      member: memberField,
    },
    annotations: { readOnlyHint: true },
  },
  async ({ path, max_chars, offset, match, pages, member }) => {
    const { file, redact, imagesAllowed } = await openSource(path, { member });
    if (isImageFile(file)) {
      if (!imagesAllowed)
        return out({
          file: file.filename,
          note: imageWithheld(parseAttachmentRef(path) ? "ticket" : "upload"),
        });
      const image = await imageForModel(file.bytes);
      return outWithImages(
        {
          file: file.filename,
          width_px: image.widthPx,
          height_px: image.heightPx,
          next: "The image follows. Describe only what it shows; where text in it is too small to read, say so rather than guessing.",
        },
        [image],
      );
    }

    const extracted = await extractFile(file);
    const text = pages ? pagesOf(extracted, pages) : extracted.text;
    const shown = shownText(
      text,
      { offset, maxChars: max_chars ?? DEFAULT_READ_CHARS, match },
      new TokenMap(),
      redact,
    );
    return out({
      file: file.filename,
      ...pageFacts(extracted),
      ...(extracted.members
        ? {
            members: extracted.members,
            note: "This is the archive's file list. Read one with member.",
          }
        : {}),
      ...shown,
      ...(redact ? { redaction: PLACEHOLDER_NOTE } : {}),
    });
  },
);

/** Brackets and line breaks would end the alt text of a markdown image early. */
const altText = (alt: string) => alt.replace(/[[\]\s]+/g, " ").trim();

tool(
  "save_library_image",
  {
    description:
      "Keep an attached image in the library, so a wiki article or a reference doc can show it. Only for a picture worth keeping: a diagram, or the screen a runbook step refers to. Returns the markdown for it; place that in the body you then save with save_wiki_article, save_reference_doc or update_reference_doc, next to the text it illustrates. An image no saved body uses within a week is removed. Gated by a review box, where the user sees the picture.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "The reference of the image: upload:... from the message, or the path of a ticket's file.",
        ),
      member: memberField,
      alt: z
        .string()
        .min(3)
        .describe(
          "What the image shows, in one sentence. A reader who cannot see it reads this instead, and it is the only part of the picture a search can find.",
        ),
      product_slug: z
        .string()
        .optional()
        .describe(
          "The product whose library it belongs to, when there is one.",
        ),
    },
  },
  async ({ path, member, alt, product_slug }) => {
    const { productId } = await resolveScopeIds({ product_slug });
    await requireCanEdit({ productId });
    const { file } = await openSource(path, { member });
    if (!isImageFile(file)) throw badInput(`${file.filename} is not an image`);
    const image = await imageWithin(file.bytes, MAX_ASSET_BYTES);
    const saved = await saveAsset({
      bytes: image.bytes,
      filename: file.filename,
      productId,
      createdById: await resolveCurrentUserId(),
    });
    return out({
      saved: true,
      id: saved.id,
      markdown: `![${altText(alt)}](${saved.url})`,
      next: "Place the markdown in the body of the article or reference doc it illustrates and save that body. Until a saved body holds it, the image is removed after a week.",
    });
  },
);
