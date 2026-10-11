import { extractText } from "unpdf";
import { isPdf } from "@tachy/core";
import { readUpload } from "@tachy/core/chat";
import { badInput } from "@tachy/core/infra";

export interface ExtractedSource {
  text: string;
  pages?: number;
}

function normalizeText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A reference reaches here from a chat upload or from text a model lifted out of
 * a ticket, so it is attacker-influenced. Only chat uploads resolve, never a
 * path on the host, and inside a turn only the turn's own user's. The stored
 * content type is what the upload route found in the bytes, so it is trusted.
 */
export async function extractSource(ref: string): Promise<ExtractedSource> {
  const { filename, contentType, bytes } = await readUpload(
    ref,
    process.env.TACHY_UPLOAD_OWNER || undefined,
  );
  const unchecked = isPdf(bytes) ? "application/pdf" : "text/plain";
  const type = contentType ?? unchecked;
  if (type.startsWith("image/"))
    throw badInput(
      `${filename} is an image, which has no text to extract; ask the user what it shows`,
    );
  if (type === "application/pdf") {
    const { totalPages, text } = await extractText(new Uint8Array(bytes), {
      mergePages: true,
    });
    return { text: normalizeText(text), pages: totalPages };
  }
  return { text: bytes.toString("utf8") };
}
