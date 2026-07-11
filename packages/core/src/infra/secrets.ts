import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";
import { badInput } from "./errors";

const ALGO: CipherGCMTypes = "aes-256-gcm";
const NONCE_BYTES = 12;

let cachedKey: Buffer | null | undefined;

/**
 * TACHY_SECRET_KEY: 32 bytes, base64 (`openssl rand -base64 32`). Unset means
 * the credential vault is disabled and resolution falls through to env vars.
 */
function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.TACHY_SECRET_KEY;
  if (!raw) return (cachedKey = null);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32)
    throw badInput(
      "TACHY_SECRET_KEY must be 32 bytes of base64 (openssl rand -base64 32)",
    );
  return (cachedKey = buf);
}

export function secretsEnabled(): boolean {
  return key() !== null;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const k = key();
  if (!k)
    throw badInput(
      "credential storage is disabled — set TACHY_SECRET_KEY to enable it",
    );
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, k, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

export function decryptSecret(row: {
  value_ciphertext: Buffer | Uint8Array;
  nonce: Buffer | Uint8Array;
}): string {
  const k = key();
  if (!k)
    throw badInput(
      "credential storage is disabled — set TACHY_SECRET_KEY to enable it",
    );
  const data = Buffer.from(row.value_ciphertext);
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(ALGO, k, Buffer.from(row.nonce));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}

/** Test hook: re-read TACHY_SECRET_KEY on next use. */
export function clearSecretKeyCache(): void {
  cachedKey = undefined;
}
