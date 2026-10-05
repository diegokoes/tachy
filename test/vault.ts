import { randomBytes } from "node:crypto";
import { clearSecretKeyCache } from "../packages/core/src/infra/secrets";

export function enableVault(): void {
  process.env.TACHY_SECRET_KEY = randomBytes(32).toString("base64");
  clearSecretKeyCache();
}

export function disableVault(): void {
  delete process.env.TACHY_SECRET_KEY;
  clearSecretKeyCache();
}
