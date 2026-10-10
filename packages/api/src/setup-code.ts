import { randomBytes, timingSafeEqual } from "node:crypto";
import { log } from "@tachy/core/infra";

/** 80 bits: out of reach of guessing, short enough to copy from a log line. */
const CODE_BYTES = 10;

let code: string | undefined;
let announced = false;

/**
 * What first-time setup asks for: proof that the caller can read this server's
 * log, which someone who only reaches its port cannot. One per process, so a
 * restart replaces it.
 */
export function setupCode(): string {
  return (code ??= randomBytes(CODE_BYTES).toString("hex"));
}

/** Writes the code to the log, once per process. */
export function announceSetupCode(): void {
  if (announced) return;
  announced = true;
  log("warn", "setup_code", {
    code: setupCode(),
    detail: "no admin exists yet: the setup wizard asks for this code",
  });
}

export function isSetupCode(given: string | undefined): boolean {
  const givenBytes = Buffer.from((given ?? "").trim().toLowerCase());
  const wantBytes = Buffer.from(setupCode());
  return (
    givenBytes.length === wantBytes.length &&
    timingSafeEqual(givenBytes, wantBytes)
  );
}
