export type AppErrorCode = "not_found" | "conflict" | "bad_input" | "forbidden";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (message: string) => new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
export const badInput = (message: string) => new AppError("bad_input", message);
export const forbidden = (message: string) =>
  new AppError("forbidden", message);
