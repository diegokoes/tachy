/** One attached file, read as what it is: an image to look at, or its text. */
import { z } from "zod";
import {
  globalImagesAllowed,
  globalRedactionEnabled,
} from "@tachy/core/compliance";
import { extractFile, imageForModel, isImageFile } from "@tachy/core/files";
import { openSource } from "../extract";
import { memberField, textWindowFields } from "../fields";
import {
  IMAGE_WITHHELD,
  PLACEHOLDER_NOTE,
  out,
  outWithImages,
  shownText,
} from "../results";
import { tool } from "../server";

/** What `read_file` returns of a text when `max_chars` is not given. */
const DEFAULT_READ_CHARS = 20_000;

tool(
  "read_file",
  {
    description:
      "Read one file the user attached, by its upload: reference. An image comes back as the image itself, for you to look at: a screenshot of an error, a photo of a label. PDF, Word, Excel, mail (.eml) and text files come back as text, truncated at max_chars (default 20000): continue with offset, or narrow a log with match. A zip answers with its file list, and member reads one of them. Open what bears on the question, not everything attached: an image costs about as much context as several pages of text. This tool only reads. To file a document in the library, use ingest_context.",
    inputSchema: {
      path: z
        .string()
        .describe("The upload: reference, exactly as the message gave it."),
      ...textWindowFields,
      member: memberField,
    },
    annotations: { readOnlyHint: true },
  },
  async ({ path, max_chars, offset, match, member }) => {
    const file = await openSource(path, { member });
    if (isImageFile(file)) {
      if (!globalImagesAllowed())
        return out({ file: file.filename, note: IMAGE_WITHHELD });
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
    const shown = shownText(extracted.text, {
      offset,
      maxChars: max_chars ?? DEFAULT_READ_CHARS,
      match,
    });
    return out({
      file: file.filename,
      ...(extracted.pages != null ? { pages: extracted.pages } : {}),
      ...(extracted.members
        ? {
            members: extracted.members,
            note: "This is the archive's file list. Read one with member.",
          }
        : {}),
      ...shown,
      ...(globalRedactionEnabled() ? { redaction: PLACEHOLDER_NOTE } : {}),
    });
  },
);
