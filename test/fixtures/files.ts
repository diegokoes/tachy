import { strToU8, zipSync } from "fflate";
import sharp from "sharp";

/** A one-page PDF whose text layer holds `text`. */
export function minimalPdf(text: string): Buffer {
  const objs: string[] = [];
  objs[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objs[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  objs[3] =
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n";
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objs[4] = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  objs[5] =
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += objs[i];
  }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++)
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

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
