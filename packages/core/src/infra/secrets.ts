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

/**
 * `aad` binds a ciphertext to the row that holds it. Without it the encryption
 * says only "this deployment wrote this", so anyone able to UPDATE the table —
 * but not read TACHY_SECRET_KEY — could move one user's credential into another
 * user's row and have it decrypt cleanly as theirs.
 */
export function encryptSecret(
  plaintext: string,
  aad?: string,
): EncryptedSecret {
  const k = key();
  if (!k)
    throw badInput(
      "credential storage is disabled — set TACHY_SECRET_KEY to enable it",
    );
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, k, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce };
}

function open(
  k: Buffer,
  row: { value_ciphertext: Buffer | Uint8Array; nonce: Buffer | Uint8Array },
  aad?: string,
): string {
  const data = Buffer.from(row.value_ciphertext);
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(ALGO, k, Buffer.from(row.nonce));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Rows written before credentials were bound to their row carry no AAD, so a
 * failed open is retried without one. That fallback is transitional: it can go
 * once every stored credential has been saved again, and until then it only
 * ever accepts what the old code would have accepted anyway.
 */
export function decryptSecret(
  row: {
    value_ciphertext: Buffer | Uint8Array;
    nonce: Buffer | Uint8Array;
  },
  aad?: string,
): string {
  const k = key();
  if (!k)
    throw badInput(
      "credential storage is disabled — set TACHY_SECRET_KEY to enable it",
    );
  if (!aad) return open(k, row);
  try {
    return open(k, row, aad);
  } catch {
    return open(k, row);
  }
}

/** Test hook: re-read TACHY_SECRET_KEY on next use. */
export function clearSecretKeyCache(): void {
  cachedKey = undefined;
}
