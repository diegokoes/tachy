import { readFile } from "node:fs/promises";
import { extractText } from "unpdf";

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

export async function extractSource(path: string): Promise<ExtractedSource> {
  const buf = await readFile(path);
  if (isPdf(path, buf)) {
    const { totalPages, text } = await extractText(new Uint8Array(buf), {
      mergePages: true,
    });
    return { text: normalizeText(text), pages: totalPages };
  }
  return { text: buf.toString("utf8") };
}
