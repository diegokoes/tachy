import { afterEach, describe, expect, it } from "vitest";
import type {
  OpenedAttachment,
  RawWorkItem,
  WorkItemSource,
} from "@tachy/core/sources";
import {
  listFiles,
  readAttachment,
  readAttachmentBytes,
} from "@tachy/core/work-items";

const item: RawWorkItem = {
  externalId: "4711",
  kind: "ticket",
  raw: {},
  messages: [
    {
      externalId: "1",
      authorLabel: "ana@example.com",
      author: "42",
      visibility: "public",
      direction: "incoming",
      bodyText: "see the screenshot",
      createdAt: "2026-03-04T05:06:00Z",
      attachments: [
        {
          id: "900",
          name: "screen.png",
          contentType: "image/png",
          sizeBytes: 2048,
        },
        { id: "901", name: "pasted.png", inline: true },
      ],
    },
    {
      externalId: "2",
      author: "7",
      visibility: "private",
      direction: "outgoing",
      bodyText: "noted",
    },
  ],
};

function stream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const sourceOpening = (opened: OpenedAttachment): WorkItemSource => ({
  type: "fake",
  capabilities: { postNote: false, incrementalSync: false },
  fetchItem: async () => item,
  listItems: async () => ({ items: [] }),
  openAttachment: async () => opened,
});

afterEach(() => {
  delete process.env.TACHY_UPLOAD_MAX_MB;
  delete process.env.TACHY_UPLOAD_IMAGE_MAX_MB;
});

describe("listFiles", () => {
  it("lists each file with who sent it, and a reference when its source opens files", () => {
    expect(listFiles(item, { source: "acme-fd", opens: true })).toEqual([
      {
        name: "screen.png",
        type: "image/png",
        size_bytes: 2048,
        from: "ana@example.com",
        at: "2026-03-04T05:06:00Z",
        path: "attachment:acme-fd/4711/900",
      },
      {
        name: "pasted.png",
        from: "ana@example.com",
        at: "2026-03-04T05:06:00Z",
        inline: true,
        path: "attachment:acme-fd/4711/901",
      },
    ]);
  });

  it("gives no reference for a source that opens none", () => {
    const files = listFiles(item, { source: "acme-fd", opens: false });
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.path === undefined)).toBe(true);
    expect(listFiles(item)[0].path).toBeUndefined();
  });
});

describe("readAttachment", () => {
  const text = (value: string) => new TextEncoder().encode(value);

  it("reads the file whole and takes its kind from its name and bytes", async () => {
    const source = sourceOpening({
      name: "app.log",
      contentType: "image/png",
      body: stream(text("10:02 ERROR "), text("timeout")),
    });
    const file = await readAttachment(source, "4711", "900");
    expect(file.filename).toBe("app.log");
    expect(file.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(file.bytes)).toBe("10:02 ERROR timeout");
  });

  it("refuses a kind there is no reader for, by name", async () => {
    const source = sourceOpening({
      name: "setup.exe",
      body: stream(text("MZ")),
    });
    await expect(readAttachment(source, "4711", "900")).rejects.toThrow(
      /setup\.exe is not a type tachy reads/,
    );
    // Its bytes are still there for whoever only wants to download it.
    const raw = await readAttachmentBytes(
      sourceOpening({ name: "setup.exe", body: stream(text("MZ")) }),
      "4711",
      "900",
    );
    expect(raw).toEqual({ filename: "setup.exe", bytes: text("MZ") });
  });

  it("stops reading past the largest size an upload may have", async () => {
    process.env.TACHY_UPLOAD_MAX_MB = "1";
    process.env.TACHY_UPLOAD_IMAGE_MAX_MB = "1";
    const megabyte = new Uint8Array(1024 * 1024);
    const source = sourceOpening({
      name: "huge.log",
      body: stream(megabyte, new Uint8Array(1)),
    });
    await expect(readAttachment(source, "4711", "900")).rejects.toThrow(
      /huge\.log is larger than the 1 MB that is read/,
    );
  });

  it("holds a file to the limit of its own kind", async () => {
    process.env.TACHY_UPLOAD_MAX_MB = "1";
    const log = new Uint8Array(1024 * 1024 + 1).fill(0x61);
    const source = sourceOpening({ name: "long.log", body: stream(log) });
    await expect(readAttachment(source, "4711", "900")).rejects.toThrow(
      /long\.log: file is 1\.0 MB, over the 1 MB upload limit/,
    );
  });

  it("says so when the source opens no files", async () => {
    const { openAttachment: _none, ...closed } = sourceOpening({
      name: "x",
      body: stream(),
    });
    await expect(readAttachment(closed, "4711", "900")).rejects.toThrow(
      /fake files cannot be opened from here/,
    );
  });
});
