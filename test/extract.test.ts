import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSource, isPdf } from "../packages/mcp/src/extract";

function minimalPdf(text: string): Buffer {
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

describe("extractSource", () => {
  it("detects PDFs by extension and by magic bytes", () => {
    const pdf = minimalPdf("x");
    expect(isPdf("doc.pdf", Buffer.from("junk"))).toBe(true);
    expect(isPdf("doc.PDF", Buffer.from("junk"))).toBe(true);
    expect(isPdf("renamed.bin", pdf)).toBe(true);
    expect(isPdf("notes.txt", Buffer.from("plain text"))).toBe(false);
  });

  it("extracts text and page count from a PDF, and passes text files through", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tachy-extract-"));
    const pdfPath = join(dir, "runbook.pdf");
    await writeFile(pdfPath, minimalPdf("Line controller failover heartbeat"));
    const pdf = await extractSource(pdfPath);
    expect(pdf.pages).toBe(1);
    expect(pdf.text).toBe("Line controller failover heartbeat");

    const txtPath = join(dir, "notes.txt");
    await writeFile(txtPath, "plain utf8 notes\n");
    const txt = await extractSource(txtPath);
    expect(txt.pages).toBeUndefined();
    expect(txt.text).toBe("plain utf8 notes\n");
  });
});
