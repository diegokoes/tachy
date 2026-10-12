import { describe, expect, it } from "vitest";
import {
  extractFile,
  joinPages,
  pageMark,
  parsePageRange,
  splitPages,
} from "@tachy/core/files";
import { chunkPages } from "@tachy/core/search";
import { pdfOf } from "../fixtures/files";

describe("page marks", () => {
  it("splits a text at its marks and joins it back", () => {
    const text = "[page 1]\nFirst page.\n\nStill first.\n\n[page 2]\nSecond.";
    const pages = splitPages(text);
    expect(pages).toEqual([
      { page: 1, text: "First page.\n\nStill first." },
      { page: 2, text: "Second." },
    ]);
    expect(joinPages(pages)).toBe(text);
  });

  it("gives text before the first mark, and a text with none, no page", () => {
    expect(splitPages("Preface.\n\n[page 3]\nBody.")).toEqual([
      { page: null, text: "Preface." },
      { page: 3, text: "Body." },
    ]);
    expect(splitPages("No marks here.")).toEqual([
      { page: null, text: "No marks here." },
    ]);
    expect(splitPages("")).toEqual([]);
  });

  it("keeps a page with no text, and reads a mark only on a line of its own", () => {
    expect(splitPages("[page 1]\n\n[page 2]\nsee [page 1] above")).toEqual([
      { page: 1, text: "" },
      { page: 2, text: "see [page 1] above" },
    ]);
    expect(pageMark(12)).toBe("[page 12]");
  });

  it("reads a page or a range of pages", () => {
    expect(parsePageRange("7")).toEqual({ from: 7, to: 7 });
    expect(parsePageRange(" 3 - 12 ")).toEqual({ from: 3, to: 12 });
    for (const bad of ["0", "5-3", "a-b", "", "3-", "1,2"])
      expect(parsePageRange(bad), bad).toBeNull();
  });
});

describe("a PDF by page", () => {
  it("marks where each page starts and names the pages with no text layer", async () => {
    const extracted = await extractFile({
      filename: "manual.pdf",
      contentType: "application/pdf",
      bytes: pdfOf(["Install the controller", "", "Reset the heartbeat"]),
    });
    expect(extracted).toEqual({
      text: "[page 1]\nInstall the controller\n\n[page 2]\n\n[page 3]\nReset the heartbeat",
      pages: 3,
      scannedPages: [2],
    });
  });
});

describe("chunkPages", () => {
  it("chunks within each page, so a chunk knows its page", () => {
    const long = "word ".repeat(400).trim();
    const chunks = chunkPages(`[page 1]\nShort one.\n\n[page 2]\n${long}`, {
      maxChars: 800,
    });
    expect(chunks[0]).toEqual({ text: "Short one.", page: 1 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.slice(1).every((chunk) => chunk.page === 2)).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("[page"))).toBe(false);
  });

  it("chunks a text with no marks as one run with no page", () => {
    expect(chunkPages("Just a note.")).toEqual([
      { text: "Just a note.", page: null },
    ]);
    expect(chunkPages("[page 1]\n\n[page 2]")).toEqual([]);
  });
});
