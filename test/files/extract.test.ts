import { describe, expect, it } from "vitest";
import { extractFile, inspectFile } from "@tachy/core/files";
import { renderXlsx } from "../../packages/core/src/exports/xlsx";
import { docx, minimalPdf, zipOf } from "../fixtures/files";

const text = (value: string) => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const document = docx("<w:p><w:r><w:t>Runbook step one</w:t></w:r></w:p>");
const sheet = renderXlsx(
  "Data",
  [{ key: "id", label: "Id", type: "string" }],
  [["FD-1"]],
);

describe("inspectFile", () => {
  it("takes an office file that holds the part its extension names", () => {
    expect(inspectFile("runbook.docx", document)).toEqual({
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(inspectFile("data.xlsx", sheet)).toEqual({
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("refuses an archive, or the other office format, renamed to one", () => {
    for (const bytes of [zipOf({ "a.txt": "x" }), sheet, text("PK")])
      expect(inspectFile("runbook.docx", bytes)).toEqual({
        refusal: expect.stringMatching(/does not contain/),
      });
    expect(inspectFile("data.xlsx", document)).toEqual({
      refusal: expect.stringMatching(/does not contain/),
    });
  });

  it("answers as the contract does for every other kind", () => {
    expect(inspectFile("notes.txt", text("hi"))).toEqual({
      contentType: "text/plain",
    });
    expect(inspectFile("tool.exe", text("hi"))).toEqual({
      refusal: expect.stringMatching(/not a type tachy reads/),
    });
  });
});

describe("extractFile", () => {
  it("decodes text by what its bytes are, and strips an HTML file to text", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x6f, 0x00, 0x6b, 0x00]);
    expect(
      await extractFile({
        filename: "a.log",
        contentType: "text/plain",
        bytes: utf16,
      }),
    ).toEqual({ text: "ok" });
    const page = await extractFile({
      filename: "page.html",
      contentType: "text/html",
      bytes: text("<html><body><p>Hello</p><script>x()</script></body></html>"),
    });
    expect(page.text).toBe("Hello");
  });

  it("reads a row stored without a content type as a PDF or as text", async () => {
    expect(
      await extractFile({
        filename: "legacy.bin",
        contentType: null,
        bytes: text("old"),
      }),
    ).toEqual({ text: "old" });
    const pdf = await extractFile({
      filename: "legacy",
      contentType: null,
      bytes: minimalPdf("Failover heartbeat"),
    });
    expect(pdf).toEqual({ text: "Failover heartbeat", pages: 1 });
  });

  it("reads a Word document, a workbook and a mail file as text", async () => {
    expect(
      (
        await extractFile({
          filename: "runbook.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: document,
        })
      ).text,
    ).toBe("Runbook step one");
    expect(
      (
        await extractFile({
          filename: "data.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes: sheet,
        })
      ).text,
    ).toBe("## Sheet: Data\nId\nFD-1");
    expect(
      (
        await extractFile({
          filename: "thread.eml",
          contentType: "message/rfc822",
          bytes: text("From: a@example.com\r\nSubject: Hi\r\n\r\nBody text"),
        })
      ).text,
    ).toBe("From: a@example.com\nSubject: Hi\n\nBody text");
  });

  it("names an image as having no text", async () => {
    await expect(
      extractFile({ filename: "s.png", contentType: "image/png", bytes: PNG }),
    ).rejects.toThrow(/s\.png is an image/);
  });

  describe("an archive", () => {
    const archive = {
      filename: "logs.zip",
      contentType: "application/zip" as const,
      bytes: zipOf({
        "app/server.log": "10:02 ERROR timeout\n",
        "docs/runbook.docx": document,
        "inner.zip": zipOf({ "a.txt": "x" }),
        "shot.png": PNG,
        "tool.exe": "MZ",
      }),
    };

    it("answers with what it holds", async () => {
      const listed = await extractFile(archive);
      expect(listed.members?.map((m) => m.name)).toEqual([
        "app/server.log",
        "docs/runbook.docx",
        "inner.zip",
        "shot.png",
        "tool.exe",
      ]);
      expect(listed.text.split("\n")[0]).toBe("app/server.log\t20 B");
    });

    it("reads one member as the kind it is", async () => {
      expect(await extractFile(archive, { member: "app/server.log" })).toEqual({
        text: "10:02 ERROR timeout\n",
      });
      expect(
        (await extractFile(archive, { member: "docs/runbook.docx" })).text,
      ).toBe("Runbook step one");
    });

    it("refuses a member it holds no reader for, and one it does not hold", async () => {
      await expect(
        extractFile(archive, { member: "inner.zip" }),
      ).rejects.toThrow(/archive inside an archive/);
      await expect(
        extractFile(archive, { member: "shot.png" }),
      ).rejects.toThrow(/is an image/);
      await expect(
        extractFile(archive, { member: "tool.exe" }),
      ).rejects.toThrow(/not a type tachy reads/);
      await expect(
        extractFile(archive, { member: "absent.log" }),
      ).rejects.toThrow(/holds no 'absent\.log'/);
    });
  });

  it("refuses a member of a file that is not an archive", async () => {
    await expect(
      extractFile(
        { filename: "a.txt", contentType: "text/plain", bytes: text("x") },
        { member: "b.txt" },
      ),
    ).rejects.toThrow(/not an archive/);
  });
});
