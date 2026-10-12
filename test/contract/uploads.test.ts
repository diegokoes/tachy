import { describe, expect, it } from "vitest";
import {
  CHAT_UPLOAD_ACCEPT,
  DEFAULT_UPLOAD_LIMITS,
  largestUploadBytes,
  parseUploadRef,
  uploadLimitBytes,
  uploadPreviewPath,
  uploadRef,
  uploadRefusal,
} from "../../packages/contract/src";

const MEGABYTE = 1024 * 1024;

describe("what a chat attachment may be", () => {
  it("offers the picker every listed extension", () => {
    expect(CHAT_UPLOAD_ACCEPT.split(",")).toContain(".pdf");
    expect(CHAT_UPLOAD_ACCEPT.split(",")).toContain(".docx");
    expect(CHAT_UPLOAD_ACCEPT).not.toContain("svg");
  });

  it("limits an image lower than a document", () => {
    expect(uploadLimitBytes("image", DEFAULT_UPLOAD_LIMITS)).toBe(
      10 * MEGABYTE,
    );
    expect(uploadLimitBytes("pdf", DEFAULT_UPLOAD_LIMITS)).toBe(25 * MEGABYTE);
    expect(largestUploadBytes(DEFAULT_UPLOAD_LIMITS)).toBe(25 * MEGABYTE);
  });

  it("tells the browser why a file should not be sent", () => {
    expect(uploadRefusal("notes.md", 10)).toBeNull();
    expect(uploadRefusal("tool.exe", 10)).toMatch(/not a type tachy reads/);
    expect(uploadRefusal("big.pdf", 25 * MEGABYTE + 1)).toMatch(
      /file is 25\.0 MB, over the 25 MB upload limit/,
    );
    expect(uploadRefusal("screen.png", 12 * MEGABYTE)).toMatch(
      /image is 12\.0 MB, over the 10 MB upload limit/,
    );
  });

  it("applies the limits the server sent in place of the defaults", () => {
    const limits = { imageBytes: 2 * MEGABYTE, fileBytes: 50 * MEGABYTE };
    expect(uploadRefusal("manual.pdf", 40 * MEGABYTE, limits)).toBeNull();
    expect(uploadRefusal("screen.png", 3 * MEGABYTE, limits)).toMatch(
      /over the 2 MB upload limit/,
    );
  });
});

describe("an upload's reference", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("names the upload and its file, and reads back", () => {
    const ref = uploadRef(id, "screen shot.png");
    expect(ref).toBe(`upload:${id}/screen shot.png`);
    expect(parseUploadRef(` ${ref} `)).toEqual({
      id,
      filename: "screen shot.png",
    });
    expect(parseUploadRef(`upload:${id}`)).toEqual({ id, filename: "" });
  });

  it("is nothing else: not a path, not a shorter id", () => {
    for (const other of ["/etc/passwd", "upload:not-a-uuid/x", "../x", ""])
      expect(parseUploadRef(other)).toBeNull();
  });

  it("gives the address the picture of an image upload loads from", () => {
    expect(uploadPreviewPath(id)).toBe(`/api/agent/uploads/${id}`);
  });
});
