import { Inflate } from "fflate";
import { AppError, badInput } from "../infra/errors";

export interface ZipEntry {
  name: string;
  /** Unpacked size as the archive declares it. */
  sizeBytes: number;
  packedBytes: number;
  /** 0 stored, 8 deflated. */
  method: number;
  encrypted: boolean;
  localHeaderAt: number;
}

/** An archive with more files than this is refused, not listed in part. */
export const ZIP_MAX_ENTRIES = 2000;

const END_RECORD = 0x06054b50;
const END_RECORD_BYTES = 22;
/** The end record may be followed by a comment of up to 65535 bytes. */
const END_SCAN_BYTES = END_RECORD_BYTES + 0xffff;
const CENTRAL_HEADER = 0x02014b50;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;
/** A size or count field holding this defers to a zip64 record. */
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const STORED = 0;
const DEFLATED = 8;

const malformed = () => badInput("the zip file is damaged or not a zip");

function endRecordAt(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_SCAN_BYTES);
  for (let at = view.byteLength - END_RECORD_BYTES; at >= lowest; at--)
    if (view.getUint32(at, true) === END_RECORD) return at;
  throw malformed();
}

/**
 * The files an archive holds, read from its central directory: the local
 * headers of a streamed archive carry no sizes. Folders are left out.
 */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < END_RECORD_BYTES) throw malformed();
  const end = endRecordAt(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === ZIP64_U16 || at === ZIP64_U32)
    throw badInput("zip64 archives are not read; repack it as a plain zip");
  if (count > ZIP_MAX_ENTRIES)
    throw badInput(
      `the zip holds ${count} entries, over the ${ZIP_MAX_ENTRIES} that are read`,
    );

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (
      at + CENTRAL_HEADER_BYTES > view.byteLength ||
      view.getUint32(at, true) !== CENTRAL_HEADER
    )
      throw malformed();
    const flags = view.getUint16(at + 8, true);
    const nameBytes = view.getUint16(at + 28, true);
    const extraBytes = view.getUint16(at + 30, true);
    const commentBytes = view.getUint16(at + 32, true);
    const name = new TextDecoder(
      flags & FLAG_UTF8 ? "utf-8" : "windows-1252",
    ).decode(
      bytes.subarray(
        at + CENTRAL_HEADER_BYTES,
        at + CENTRAL_HEADER_BYTES + nameBytes,
      ),
    );
    if (!name.endsWith("/"))
      entries.push({
        name,
        sizeBytes: view.getUint32(at + 24, true),
        packedBytes: view.getUint32(at + 20, true),
        method: view.getUint16(at + 10, true),
        encrypted: (flags & FLAG_ENCRYPTED) !== 0,
        localHeaderAt: view.getUint32(at + 42, true),
      });
    at += CENTRAL_HEADER_BYTES + nameBytes + extraBytes + commentBytes;
  }
  return entries;
}

/** Packed bytes fed to the inflater at a time, which bounds one step's output. */
const INFLATE_STEP_BYTES = 16 * 1024;

/**
 * Inflates up to `maxBytes` and refuses past it. The size an archive declares
 * is its author's claim, so the output is counted as it is produced.
 */
function inflateCapped(packed: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw tooLarge(maxBytes);
    chunks.push(chunk);
  });
  for (let at = 0; at < packed.length; at += INFLATE_STEP_BYTES) {
    const last = at + INFLATE_STEP_BYTES >= packed.length;
    inflater.push(packed.subarray(at, at + INFLATE_STEP_BYTES), last);
  }
  const unpacked = new Uint8Array(total);
  let filled = 0;
  for (const chunk of chunks) {
    unpacked.set(chunk, filled);
    filled += chunk.length;
  }
  return unpacked;
}

const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);

const tooLarge = (maxBytes: number) =>
  badInput(
    `the file unpacks to more than the ${megabytes(maxBytes)} MB that is read`,
  );

/** One entry's bytes, unpacked. */
export function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxBytes: number,
): Uint8Array {
  if (entry.encrypted)
    throw badInput(`${entry.name} is password-protected and cannot be read`);
  if (entry.sizeBytes > maxBytes) throw tooLarge(maxBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderAt;
  if (
    header + LOCAL_HEADER_BYTES > view.byteLength ||
    view.getUint32(header, true) !== LOCAL_HEADER
  )
    throw malformed();
  const start =
    header +
    LOCAL_HEADER_BYTES +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true);
  const packed = bytes.subarray(start, start + entry.packedBytes);
  if (packed.length !== entry.packedBytes) throw malformed();
  if (entry.method === STORED) return packed;
  if (entry.method !== DEFLATED)
    throw badInput(
      `${entry.name} uses a compression (method ${entry.method}) that is not read`,
    );
  try {
    return inflateCapped(packed, maxBytes);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw malformed();
  }
}
