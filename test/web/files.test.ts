import { describe, expect, it } from "vitest";
import {
  fileDetails,
  fileHref,
  isPicture,
} from "../../packages/web/src/work-items/files";

describe("a ticket's file in the chat", () => {
  it("opens from the address its reference names, or from nowhere", () => {
    expect(
      fileHref({ name: "a.png", path: "attachment:acme-fd/4711/900" }),
    ).toBe("/api/work-items/acme-fd/4711/attachments/900");
    expect(fileHref({ name: "a.png" })).toBeNull();
    expect(fileHref({ name: "a.png", path: "upload:x" })).toBeNull();
  });

  it("is shown as a picture by its name", () => {
    expect(isPicture({ name: "Screen Shot.PNG" })).toBe(true);
    expect(isPicture({ name: "photo.jpeg" })).toBe(true);
    expect(isPicture({ name: "app.log" })).toBe(false);
    expect(isPicture({ name: "drawing.svg" })).toBe(false);
    expect(isPicture({ name: "no-extension" })).toBe(false);
  });

  it("says its size, who sent it and when, and that it stood in the message", () => {
    expect(
      fileDetails({
        name: "a.png",
        size_bytes: 67658,
        from: "ana@example.com",
        at: "2026-03-04T05:06:00Z",
        inline: true,
      }),
    ).toBe("66 KB · ana@example.com · 2026-03-04 · in the message");
    expect(fileDetails({ name: "a.png", size_bytes: 900 })).toBe("900 B");
    expect(fileDetails({ name: "a.png", size_bytes: 3_500_000 })).toBe(
      "3.3 MB",
    );
    expect(fileDetails({ name: "a.png" })).toBe("");
  });
});
