import { extractText } from "unpdf";
import { readUpload } from "@tachy/core";

export function isPdf(path: string, buf: Buffer): boolean {
  return (
    path.toLowerCase().endsWith(".pdf") ||
    buf.subarray(0, 5).toString("latin1") === "%PDF-"
  );
}

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
 * path on the host, and inside a turn only the turn's own user's.
 */
export async function extractSource(ref: string): Promise<ExtractedSource> {
  const { filename, bytes: buf } = await readUpload(
    ref,
    process.env.TACHY_UPLOAD_OWNER || undefined,
  );
  if (isPdf(filename, buf)) {
    const { totalPages, text } = await extractText(new Uint8Array(buf), {
      mergePages: true,
    });
    return { text: normalizeText(text), pages: totalPages };
  }
  return { text: buf.toString("utf8") };
}
