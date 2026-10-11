import { describe, expect, it } from "vitest";
import {
  CHAT_UPLOAD_ACCEPT,
  MAX_UPLOAD_BYTES,
  checkUpload,
  isText,
  uploadExtension,
  uploadRefusal,
} from "../../packages/contract/src";

const text = (value: string) => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]);

describe("what a chat attachment may be", () => {
  it("reads the extension whatever its case, and only a listed one", () => {
    expect(uploadExtension("Notes.TXT")).toBe("txt");
    expect(uploadExtension("archive.tar.gz")).toBeNull();
    expect(uploadExtension("no-extension")).toBeNull();
    expect(uploadExtension("picture.svg")).toBeNull();
    expect(uploadExtension("x.constructor")).toBeNull();
  });

  it("offers the picker every listed extension", () => {
    expect(CHAT_UPLOAD_ACCEPT.split(",")).toContain(".pdf");
    expect(CHAT_UPLOAD_ACCEPT).not.toContain("svg");
  });

  it("tells the browser why a file should not be sent", () => {
    expect(uploadRefusal("notes.md", 10)).toBeNull();
    expect(uploadRefusal("report.docx", 10)).toMatch(
      /not a type chat can read/,
    );
    expect(uploadRefusal("big.pdf", MAX_UPLOAD_BYTES + 1)).toMatch(
      /over the 25 MB upload limit/,
    );
  });

  it("takes a file whose bytes are what its extension says", () => {
    expect(checkUpload("notes.md", text("# title"))).toEqual({
      contentType: "text/markdown",
    });
    expect(checkUpload("data.json", text("{}"))).toEqual({
      contentType: "application/json",
    });
    expect(checkUpload("doc.pdf", text("%PDF-1.7 ..."))).toEqual({
      contentType: "application/pdf",
    });
  });

  it("records an image as the type its bytes are", () => {
    expect(checkUpload("screen.jpg", PNG)).toEqual({
      contentType: "image/png",
    });
  });

  it("refuses bytes that are not what the extension says", () => {
    for (const name of ["renamed.txt", "renamed.pdf", "renamed.png"])
      expect(checkUpload(name, ZIP)).toEqual({
        refusal: expect.stringMatching(/does not contain/),
      });
    expect(checkUpload("report.docx", ZIP)).toEqual({
      refusal: expect.stringMatching(/not a type chat can read/),
    });
  });

  it("counts as text only valid UTF-8 without a NUL", () => {
    expect(isText(text("grüße"))).toBe(true);
    expect(isText(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(isText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });
});
