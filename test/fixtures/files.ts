import { strToU8, zipSync } from "fflate";
import sharp from "sharp";

/** A picture as a PDF stores one uncompressed: RGB, row by row. */
export interface PdfPicture {
  widthPx: number;
  heightPx: number;
  rgb: Uint8Array;
}

/** A picture of one colour. `shade` tells two of the same size apart. */
export function flatPicture(
  widthPx: number,
  heightPx: number,
  shade: number,
): PdfPicture {
  const rgb = new Uint8Array(widthPx * heightPx * 3);
  for (let at = 0; at < rgb.length; at += 3) rgb[at] = shade;
  return { widthPx, heightPx, rgb };
}

/**
 * A PDF with a page per entry: the text of its text layer, the pictures placed
 * on it, or both. A page with a picture and no text is what a scan is.
 */
export function pdfWith(
  pages: { text?: string; pictures?: PdfPicture[] }[],
): Buffer {
  const objects: (string | Uint8Array)[][] = [];
  const add = (...parts: (string | Uint8Array)[]) => objects.push(parts);
  const CATALOG = add("");
  const PAGES = add("");
  const FONT = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageIds = pages.map(({ text, pictures = [] }) => {
    let content = text ? `BT /F1 24 Tf 72 720 Td (${text}) Tj ET\n` : "";
    const names = pictures.map((picture, i) => {
      const id = add(
        `<< /Type /XObject /Subtype /Image /Width ${picture.widthPx} /Height ${picture.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${picture.rgb.length} >>\nstream\n`,
        picture.rgb,
        "\nendstream",
      );
      content += `q ${picture.widthPx} 0 0 ${picture.heightPx} 72 100 cm /Im${i} Do Q\n`;
      return `/Im${i} ${id} 0 R`;
    });
    const contentId = add(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    return add(
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${FONT} 0 R >> /XObject << ${names.join(" ")} >> >> >>`,
    );
  });
  objects[CATALOG - 1] = [`<< /Type /Catalog /Pages ${PAGES} 0 R >>`];
  objects[PAGES - 1] = [
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  ];

  const chunks: Buffer[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const chunk =
      typeof part === "string"
        ? Buffer.from(part, "latin1")
        : Buffer.from(part);
    chunks.push(chunk);
    length += chunk.length;
  };
  write("%PDF-1.4\n");
  const offsets = objects.map((parts, i) => {
    const at = length;
    write(`${i + 1} 0 obj\n`);
    parts.forEach(write);
    write("\nendobj\n");
    return at;
  });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const at of offsets) write(String(at).padStart(10, "0") + " 00000 n \n");
  write(
    `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return Buffer.concat(chunks);
}

/** A PDF of text pages. An empty entry is a page with no text layer. */
export const pdfOf = (pageTexts: string[]) =>
  pdfWith(pageTexts.map((text) => ({ text })));

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
