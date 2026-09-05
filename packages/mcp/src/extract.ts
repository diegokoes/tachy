import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { extractText } from "unpdf";
import { badInput, uploadDir } from "@tachy/core";

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
 * A path reaches here from a chat upload or from text a model lifted out of a
 * ticket, so it is attacker-influenced: unconfined, `readFile` would serve the
 * vault key out of /proc, or another user's agent credentials. Symlinks are
 * resolved before the comparison, or a link inside the upload directory would
 * step straight back out of it.
 */
async function confinedToUploads(path: string): Promise<string> {
  const root = await realpath(uploadDir()).catch(() => resolve(uploadDir()));
  const target = await realpath(path).catch(() => resolve(path));
  if (target !== root && !target.startsWith(root + sep))
    throw badInput(
      `'${path}' is not an uploaded file — only files under the upload directory can be read`,
    );
  return target;
}

export async function extractSource(path: string): Promise<ExtractedSource> {
  const buf = await readFile(await confinedToUploads(path));
  if (isPdf(path, buf)) {
    const { totalPages, text } = await extractText(new Uint8Array(buf), {
      mergePages: true,
    });
    return { text: normalizeText(text), pages: totalPages };
  }
  return { text: buf.toString("utf8") };
}
