export type AppErrorCode =
  "not_found" | "conflict" | "bad_input" | "forbidden" | "unavailable";

/** Members the answer carries beside the message, for a client to branch on. */
export type ErrorExtensions = Record<string, unknown>;

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly extensions: ErrorExtensions = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

const raising =
  (code: AppErrorCode) => (message: string, extensions?: ErrorExtensions) =>
    new AppError(code, message, extensions);

export const notFound = raising("not_found");
export const conflict = raising("conflict");
export const badInput = raising("bad_input");
export const forbidden = raising("forbidden");
/** Temporary: the caller should retry, e.g. while the server drains. */
export const unavailable = raising("unavailable");
