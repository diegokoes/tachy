import {
  FILE_EXTENSIONS,
  FILE_TYPES,
  fileExtension,
  unlistedReason,
  type FileFamily,
} from "./files";

/** For `<input type="file" accept>`. */
export const CHAT_UPLOAD_ACCEPT = FILE_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

const MEGABYTE = 1024 * 1024;

/**
 * The most a chat upload may weigh. An image has its own, lower limit: it is
 * sent to the model as a picture, where a document is sent as its text.
 */
export interface UploadLimits {
  imageBytes: number;
  fileBytes: number;
}

/** What a host that sets nothing gets; the server sends the SPA its own. */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  imageBytes: 10 * MEGABYTE,
  fileBytes: 25 * MEGABYTE,
};

export const uploadLimitBytes = (family: FileFamily, limits: UploadLimits) =>
  family === "image" ? limits.imageBytes : limits.fileBytes;

/** The largest file of any kind, which bounds the request that carries one. */
export const largestUploadBytes = (limits: UploadLimits) =>
  Math.max(limits.imageBytes, limits.fileBytes);

const megabytes = (bytes: number) => (bytes / MEGABYTE).toFixed(1);

export const tooLargeReason = (
  bytes: number,
  limitBytes: number,
  family?: FileFamily,
) =>
  `${family === "image" ? "image" : "file"} is ${megabytes(bytes)} MB, over the ${limitBytes / MEGABYTE} MB upload limit`;

/**
 * Why the browser should not send this file, or null. It sees the name and the
 * size; the server repeats both checks and also reads the bytes.
 */
export function uploadRefusal(
  filename: string,
  bytes: number,
  limits: UploadLimits = DEFAULT_UPLOAD_LIMITS,
): string | null {
  const extension = fileExtension(filename);
  if (!extension) return unlistedReason(filename);
  const { family } = FILE_TYPES[extension];
  const limitBytes = uploadLimitBytes(family, limits);
  return bytes > limitBytes ? tooLargeReason(bytes, limitBytes, family) : null;
}

/**
 * How an upload is named to the agent and its tools: a reference, not a file
 * path, so it resolves the same on every replica and can never name a file on
 * the host.
 */
export const uploadRef = (id: string, filename: string) =>
  `upload:${id}/${filename}`;

const UPLOAD_REF_RE = /^upload:([0-9a-f-]{36})(?:\/(.*))?$/;

export function parseUploadRef(
  ref: string,
): { id: string; filename: string } | null {
  const match = UPLOAD_REF_RE.exec(ref.trim());
  return match ? { id: match[1], filename: match[2] ?? "" } : null;
}

/** Where the SPA loads the picture an image upload holds, for its owner. */
export const uploadPreviewPath = (id: string) => `/api/agent/uploads/${id}`;
