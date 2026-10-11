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
