import { describe, expect, it } from "vitest";
import {
  FILE_CONTENT_TYPES,
  FILE_EXTENSIONS,
  checkFile,
  decodeText,
  fileExtension,
  fileFamily,
  isText,
  isZip,
} from "../../packages/contract/src";

const text = (value: string) => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]);

/** UTF-16 with its byte order mark, as PowerShell's redirect writes a log. */
function utf16(value: string, order: "le" | "be"): Uint8Array {
  const bytes = [order === "le" ? 0xff : 0xfe, order === "le" ? 0xfe : 0xff];
  for (const char of value) {
    const code = char.charCodeAt(0);
    const [low, high] = [code & 0xff, code >> 8];
    bytes.push(...(order === "le" ? [low, high] : [high, low]));
  }
  return new Uint8Array(bytes);
}

describe("what a file may be", () => {
  it("reads the extension whatever its case, and only a listed one", () => {
    expect(fileExtension("Notes.TXT")).toBe("txt");
    expect(fileExtension("archive.tar.gz")).toBeNull();
    expect(fileExtension("no-extension")).toBeNull();
    expect(fileExtension("picture.svg")).toBeNull();
    expect(fileExtension("x.constructor")).toBeNull();
    expect(fileExtension("legacy.doc")).toBeNull();
  });

  it("lists the text formats, mail, archives and office files", () => {
    for (const extension of [
      "xml",
      "yaml",
      "har",
      "eml",
      "zip",
      "docx",
      "xlsx",
    ])
      expect(FILE_EXTENSIONS).toContain(extension);
  });

  it("puts each content type in one family", () => {
    for (const contentType of FILE_CONTENT_TYPES)
      expect(fileFamily(contentType)).toBeTruthy();
    expect(fileFamily("application/json")).toBe("text");
    expect(fileFamily("message/rfc822")).toBe("mail");
    expect(fileFamily("application/zip")).toBe("archive");
  });
});

describe("text, whatever wrote it", () => {
  it("decodes UTF-8 with and without a byte order mark", () => {
    expect(decodeText(text("grüße"))).toBe("grüße");
    expect(
      decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...text("grüße")])),
    ).toBe("grüße");
  });

  it("decodes UTF-16 in either byte order when a mark names it", () => {
    expect(decodeText(utf16("Fehler: Zeitüberschreitung", "le"))).toBe(
      "Fehler: Zeitüberschreitung",
    );
    expect(decodeText(utf16("error 42", "be"))).toBe("error 42");
  });

  it("decodes Windows-1252 when the bytes are not UTF-8", () => {
    const latin = new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x0a]);
    expect(decodeText(latin)).toBe("Grüße\n");
  });

  it("is not text with a NUL, a torn UTF-16 unit, or mostly control bytes", () => {
    expect(isText(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(isText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
    expect(isText(new Uint8Array([0x01, 0x02, 0x03, 0xff, 0x04, 0x05]))).toBe(
      false,
    );
    expect(isText(ZIP)).toBe(false);
  });
});

describe("checkFile", () => {
  it("takes a file whose bytes are what its extension says", () => {
    expect(checkFile("notes.md", text("# title"))).toEqual({
      contentType: "text/markdown",
    });
    expect(checkFile("trace.har", text('{"log":{}}'))).toEqual({
      contentType: "application/json",
    });
    expect(checkFile("doc.pdf", text("%PDF-1.7 ..."))).toEqual({
      contentType: "application/pdf",
    });
    expect(checkFile("server.log", utf16("started", "le"))).toEqual({
      contentType: "text/plain",
    });
  });

  it("records an image as the type its bytes are", () => {
    expect(checkFile("screen.jpg", PNG)).toEqual({ contentType: "image/png" });
  });

  it("takes a mail file that opens with a header field", () => {
    expect(
      checkFile("thread.eml", text("Received: by mx\r\nSubject: hi\r\n\r\nx")),
    ).toEqual({ contentType: "message/rfc822" });
    expect(checkFile("thread.eml", text("just some prose"))).toEqual({
      refusal: expect.stringMatching(/does not contain/),
    });
  });

  it("holds an archive and an office file to being a zip", () => {
    expect(isZip(ZIP)).toBe(true);
    expect(checkFile("logs.zip", ZIP)).toEqual({
      contentType: "application/zip",
    });
    expect(checkFile("report.docx", text("not a zip"))).toEqual({
      refusal: expect.stringMatching(/does not contain/),
    });
  });

  it("refuses bytes that are not what the extension says", () => {
    for (const name of ["renamed.txt", "renamed.pdf", "renamed.png"])
      expect(checkFile(name, ZIP)).toEqual({
        refusal: expect.stringMatching(/does not contain/),
      });
    expect(checkFile("tool.exe", ZIP)).toEqual({
      refusal: expect.stringMatching(/not a type tachy reads/),
    });
  });
});
