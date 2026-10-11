import { sniffImage } from "./assets";

/**
 * What tachy reads, by extension: a file attached in chat, and a file on a
 * ticket. An extension is listed only when something turns its bytes into what
 * a model reads. SVG is absent for the reason LIBRARY_ASSET_TYPES gives.
 */
export const FILE_TYPES = {
  png: { mime: "image/png", family: "image" },
  jpg: { mime: "image/jpeg", family: "image" },
  jpeg: { mime: "image/jpeg", family: "image" },
  gif: { mime: "image/gif", family: "image" },
  webp: { mime: "image/webp", family: "image" },
  pdf: { mime: "application/pdf", family: "pdf" },
  txt: { mime: "text/plain", family: "text" },
  md: { mime: "text/markdown", family: "text" },
  log: { mime: "text/plain", family: "text" },
  csv: { mime: "text/csv", family: "text" },
  tsv: { mime: "text/tab-separated-values", family: "text" },
  json: { mime: "application/json", family: "text" },
  har: { mime: "application/json", family: "text" },
  xml: { mime: "application/xml", family: "text" },
  yaml: { mime: "application/yaml", family: "text" },
  yml: { mime: "application/yaml", family: "text" },
  html: { mime: "text/html", family: "text" },
  htm: { mime: "text/html", family: "text" },
  ini: { mime: "text/plain", family: "text" },
  conf: { mime: "text/plain", family: "text" },
  properties: { mime: "text/plain", family: "text" },
  sql: { mime: "text/plain", family: "text" },
  eml: { mime: "message/rfc822", family: "mail" },
  zip: { mime: "application/zip", family: "archive" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    family: "document",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    family: "sheet",
  },
} as const;

export type FileExtension = keyof typeof FILE_TYPES;
export type FileContentType = (typeof FILE_TYPES)[FileExtension]["mime"];
export type FileFamily = (typeof FILE_TYPES)[FileExtension]["family"];

/** Every content type a stored file carries: the `chat_uploads` CHECK. */
export const FILE_CONTENT_TYPES = [
  ...new Set(Object.values(FILE_TYPES).map((type) => type.mime)),
] as FileContentType[];

export const FILE_EXTENSIONS = Object.keys(FILE_TYPES) as FileExtension[];

export function fileExtension(filename: string): FileExtension | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  return Object.hasOwn(FILE_TYPES, extension)
    ? (extension as FileExtension)
    : null;
}

/** Each content type belongs to one family, whichever extension named it. */
export function fileFamily(contentType: FileContentType): FileFamily {
  const type = Object.values(FILE_TYPES).find((t) => t.mime === contentType);
  return type!.family;
}

const starts = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

const ascii = (bytes: Uint8Array, length: number) =>
  String.fromCharCode(...bytes.subarray(0, length));

const PDF_MAGIC = "%PDF-";

export const isPdf = (bytes: Uint8Array) =>
  ascii(bytes, PDF_MAGIC.length) === PDF_MAGIC;

/** A zip with entries, or an empty one. An office document is the first. */
export const isZip = (bytes: Uint8Array) =>
  starts(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
  starts(bytes, [0x50, 0x4b, 0x05, 0x06]);

function decodeStrict(encoding: string, bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

const TAB = 0x09;
const LINE_FEED = 0x0a;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const ESCAPE = 0x1b;
const SPACE = 0x20;
const TEXT_CONTROLS = new Set([
  TAB,
  LINE_FEED,
  FORM_FEED,
  CARRIAGE_RETURN,
  ESCAPE,
]);
/** The share of other control bytes above which bytes are not legacy text. */
const CONTROL_SHARE_MAX = 0.01;

/**
 * Windows-1252 decodes any byte, so it is taken only for bytes that read as
 * text: nearly no control characters besides the ones a text file holds.
 */
function decodeLegacy(bytes: Uint8Array): string | null {
  let controls = 0;
  for (const byte of bytes)
    if (byte < SPACE && !TEXT_CONTROLS.has(byte)) controls++;
  if (controls > bytes.length * CONTROL_SHARE_MAX) return null;
  return new TextDecoder("windows-1252").decode(bytes);
}

/**
 * The text the bytes hold, or null when they are not text. A byte order mark
 * names UTF-8 or UTF-16; without one the bytes are UTF-8, or else the
 * Windows-1252 older Windows tools write. A NUL outside UTF-16 is what a
 * renamed archive or office file has, so it is never text.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (starts(bytes, [0xff, 0xfe])) return decodeStrict("utf-16le", bytes);
  if (starts(bytes, [0xfe, 0xff])) return decodeStrict("utf-16be", bytes);
  if (bytes.includes(0)) return null;
  return decodeStrict("utf-8", bytes) ?? decodeLegacy(bytes);
}

export const isText = (bytes: Uint8Array) => decodeText(bytes) !== null;

const HEADER_SCAN_BYTES = 2048;
/** A header field at the start of a line, as RFC 5322 writes one. */
const MAIL_HEADER = /^[A-Za-z][A-Za-z0-9-]*:[ \t]/m;

const isMail = (bytes: Uint8Array) =>
  isText(bytes) && MAIL_HEADER.test(ascii(bytes, HEADER_SCAN_BYTES));

export type FileCheck = { contentType: FileContentType } | { refusal: string };

export const unlistedReason = (filename: string) =>
  `${filename} is not a type tachy reads; attach ${FILE_EXTENSIONS.join(", ")}`;

export const mismatchReason = (filename: string, extension: FileExtension) =>
  `${filename} does not contain what its extension says (.${extension})`;

/**
 * The content type the bytes bear out, or null. An office document is only
 * held to being a zip here: telling it from an archive takes reading its
 * entries, which the server does.
 */
function holds(
  extension: FileExtension,
  bytes: Uint8Array,
): FileContentType | null {
  const { family, mime } = FILE_TYPES[extension];
  if (family === "image") return sniffImage(bytes);
  if (family === "pdf") return isPdf(bytes) ? mime : null;
  if (family === "mail") return isMail(bytes) ? mime : null;
  if (family === "text") return isText(bytes) ? mime : null;
  return isZip(bytes) ? mime : null;
}

/** The extension has to be listed, and the bytes have to be what it says. */
export function checkFile(filename: string, bytes: Uint8Array): FileCheck {
  const extension = fileExtension(filename);
  if (!extension) return { refusal: unlistedReason(filename) };
  const contentType = holds(extension, bytes);
  return contentType
    ? { contentType }
    : { refusal: mismatchReason(filename, extension) };
}
