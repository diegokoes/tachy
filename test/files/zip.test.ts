import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, zipSync } from "fflate";
import {
  ZIP_MAX_ENTRIES,
  readZipEntry,
  zipEntries,
} from "../../packages/core/src/files/zip";
import { zipOf } from "../fixtures/files";

const CENTRAL_HEADER = 0x02014b50;

/** Overwrites one field of the archive's first central directory header. */
function patchCentral(
  zip: Uint8Array,
  fieldAt: number,
  value: number,
  width: 2 | 4,
): Uint8Array {
  const patched = zip.slice();
  const view = new DataView(patched.buffer);
  let at = 0;
  while (view.getUint32(at, true) !== CENTRAL_HEADER) at++;
  if (width === 2) view.setUint16(at + fieldAt, value, true);
  else view.setUint32(at + fieldAt, value, true);
  return patched;
}

describe("zipEntries", () => {
  it("lists the files with their unpacked sizes, and leaves folders out", () => {
    const zip = zipSync({
      "logs/": new Uint8Array(0),
      "logs/app.log": strToU8("line one\nline two\n"),
      "readme.txt": strToU8("hi"),
    });
    expect(
      zipEntries(zip).map(({ name, sizeBytes }) => ({ name, sizeBytes })),
    ).toEqual([
      { name: "logs/app.log", sizeBytes: 18 },
      { name: "readme.txt", sizeBytes: 2 },
    ]);
  });

  it("refuses bytes that are not a zip", () => {
    expect(() => zipEntries(new Uint8Array(10))).toThrow(
      /damaged or not a zip/,
    );
    expect(() => zipEntries(new Uint8Array(64))).toThrow(
      /damaged or not a zip/,
    );
  });

  it("refuses an archive with more entries than it reads", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++)
      files[`f${i}.txt`] = strToU8("x");
    expect(() => zipEntries(zipSync(files))).toThrow(/over the 2000/);
  });
});

describe("readZipEntry", () => {
  it("unpacks a deflated entry and a stored one", () => {
    const text = "the same line again\n".repeat(200);
    const deflated = zipOf({ "a.log": text });
    const [entry] = zipEntries(deflated);
    expect(entry.method).toBe(8);
    expect(strFromU8(readZipEntry(deflated, entry, 1_000_000))).toBe(text);

    const stored = zipSync({ "a.log": strToU8(text) }, { level: 0 });
    const [plain] = zipEntries(stored);
    expect(plain.method).toBe(0);
    expect(strFromU8(readZipEntry(stored, plain, 1_000_000))).toBe(text);
  });

  it("refuses an entry that declares more than the limit", () => {
    const zip = zipOf({ "big.log": "x".repeat(50_000) });
    expect(() => readZipEntry(zip, zipEntries(zip)[0], 1000)).toThrow(
      /unpacks to more than/,
    );
  });

  it("stops unpacking at the limit when the declared size lies", () => {
    const honest = zipOf({ "bomb.log": "0".repeat(2_000_000) });
    const lying = patchCentral(honest, 24, 10, 4);
    const [entry] = zipEntries(lying);
    expect(entry.sizeBytes).toBe(10);
    expect(() => readZipEntry(lying, entry, 100_000)).toThrow(
      /unpacks to more than/,
    );
  });

  it("refuses an encrypted entry and a compression it does not read", () => {
    const zip = zipOf({ "a.txt": "secret ".repeat(50) });
    const encrypted = patchCentral(zip, 8, 0x1, 2);
    expect(() =>
      readZipEntry(encrypted, zipEntries(encrypted)[0], 10_000),
    ).toThrow(/password-protected/);
    const bzip = patchCentral(zip, 10, 12, 2);
    expect(() => readZipEntry(bzip, zipEntries(bzip)[0], 10_000)).toThrow(
      /method 12/,
    );
  });

  it("reports a damaged entry as a damaged zip", () => {
    const zip = zipOf({ "a.txt": "some text ".repeat(100) });
    const [entry] = zipEntries(zip);
    expect(() =>
      readZipEntry(zip, { ...entry, localHeaderAt: 7 }, 10_000),
    ).toThrow(/damaged or not a zip/);
    expect(() =>
      readZipEntry(zip, { ...entry, packedBytes: zip.length * 2 }, 10_000),
    ).toThrow(/damaged or not a zip/);
  });
});
