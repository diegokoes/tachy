import { sniffImage } from "./assets";

/**
 * What a chat attachment may be, by extension: what the agent's tools read.
 * SVG is absent for the reason LIBRARY_ASSET_TYPES gives; office and archive
 * formats are absent because nothing extracts them.
 */
export const CHAT_UPLOAD_TYPES = {
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
  json: { mime: "application/json", family: "text" },
} as const;

export type ChatUploadExtension = keyof typeof CHAT_UPLOAD_TYPES;
export type ChatUploadContentType =
  (typeof CHAT_UPLOAD_TYPES)[ChatUploadExtension]["mime"];

/** Every content type a stored upload carries: the `chat_uploads` CHECK. */
export const CHAT_UPLOAD_CONTENT_TYPES = [
  ...new Set(Object.values(CHAT_UPLOAD_TYPES).map((type) => type.mime)),
] as ChatUploadContentType[];

export const CHAT_UPLOAD_EXTENSIONS = Object.keys(
  CHAT_UPLOAD_TYPES,
) as ChatUploadExtension[];

/** For `<input type="file" accept>`. */
export const CHAT_UPLOAD_ACCEPT = CHAT_UPLOAD_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function uploadExtension(filename: string): ChatUploadExtension | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CHAT_UPLOAD_TYPES, extension)
    ? (extension as ChatUploadExtension)
    : null;
}

const PDF_MAGIC = "%PDF-";

export const isPdf = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.subarray(0, PDF_MAGIC.length)) === PDF_MAGIC;

/** Valid UTF-8 with no NUL byte, which a renamed archive or office file is not. */
export function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export const tooLargeReason = (bytes: number) =>
  `file is ${megabytes(bytes)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`;

const unlistedReason = (filename: string) =>
  `${filename} is not a type chat can read; attach ${CHAT_UPLOAD_EXTENSIONS.join(", ")}`;

/**
 * Why the browser should not send this file, or null. It sees the name and the
 * size; the server repeats both checks and also reads the bytes.
 */
export function uploadRefusal(filename: string, bytes: number): string | null {
  if (!uploadExtension(filename)) return unlistedReason(filename);
  if (bytes > MAX_UPLOAD_BYTES) return tooLargeReason(bytes);
  return null;
}

export type UploadCheck =
  { contentType: ChatUploadContentType } | { refusal: string };

function holds(extension: ChatUploadExtension, bytes: Uint8Array) {
  const { family, mime } = CHAT_UPLOAD_TYPES[extension];
  if (family === "image") return sniffImage(bytes);
  if (family === "pdf") return isPdf(bytes) ? mime : null;
  return isText(bytes) ? mime : null;
}

/** The extension has to be listed, and the bytes have to be what it says. */
export function checkUpload(filename: string, bytes: Uint8Array): UploadCheck {
  const extension = uploadExtension(filename);
  if (!extension) return { refusal: unlistedReason(filename) };
  const contentType = holds(extension, bytes);
  return contentType
    ? { contentType }
    : {
        refusal: `${filename} does not contain what its extension says (.${extension})`,
      };
}
