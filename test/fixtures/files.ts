import { strToU8, zipSync } from "fflate";
import sharp from "sharp";

/**
 * A PDF with one page per entry, each holding that text in its text layer. An
 * empty entry is a page with none, as a scanned page is.
 */
export function pdfOf(pageTexts: string[]): Buffer {
  const fontId = 3 + pageTexts.length * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  ];
  pageTexts.forEach((text, i) => {
    const contentId = 4 + i * 2;
    const stream = text ? `BT /F1 24 Tf 72 720 Td (${text}) Tj ET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += String(at).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** A one-page PDF whose text layer holds `text`. */
export const minimalPdf = (text: string) => pdfOf([text]);

const WORD_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word document holding `body` as the content of its `w:body`. */
export function docx(body: string, styles = ""): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document ${WORD_NS}><w:body>${body}</w:body></w:document>`,
    ),
    "word/styles.xml": strToU8(
      `<?xml version="1.0"?><w:styles ${WORD_NS}>${styles}</w:styles>`,
    ),
  });
}

/** A zip of text files by name. */
export const zipOf = (files: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        typeof content === "string" ? strToU8(content) : content,
      ]),
    ),
  );

/** A plain image of the given size, as a real encoded file. */
export async function picture(
  widthPx: number,
  heightPx: number,
  format: "png" | "jpeg" | "webp" | "gif" = "png",
): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width: widthPx,
      height: heightPx,
      channels: 3,
      background: { r: 200, g: 60, b: 20 },
    },
  });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}
