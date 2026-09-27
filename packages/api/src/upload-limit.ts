import { badInput } from "@tachy/core";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export const tooLarge = (bytes: number) =>
  badInput(
    `file is ${megabytes(bytes)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`,
  );
