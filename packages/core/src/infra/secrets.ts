import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";
import { badInput } from "./errors";

const ALGO: CipherGCMTypes = "aes-256-gcm";
const NONCE_BYTES = 12;

export interface VaultKey {
  id: string;
  bytes: Buffer;
}

let cachedKeys: VaultKey[] | undefined;

const parseKey = (raw: string, name: string): VaultKey => {
  const bytes = Buffer.from(raw.trim(), "base64");
  if (bytes.length !== 32)
    throw badInput(
      `${name} must be 32 bytes of base64 (openssl rand -base64 32)`,
    );
  return { id: keyId(bytes), bytes };
};

/** Short, stable and not secret: it names a key without revealing anything. */
export const keyId = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 8);

/**
 * TACHY_SECRET_KEY is the key new secrets are written with.
 * TACHY_SECRET_KEY_PREVIOUS (comma separated) still opens rows written before a
 * rotation, until `npm run sync rotate-key` has moved them over.
 */
export function vaultKeys(): VaultKey[] {
  if (cachedKeys !== undefined) return cachedKeys;
  const raw = process.env.TACHY_SECRET_KEY;
  if (!raw) return (cachedKeys = []);
  const keys = [parseKey(raw, "TACHY_SECRET_KEY")];
  for (const old of (process.env.TACHY_SECRET_KEY_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean))
    keys.push(parseKey(old, "TACHY_SECRET_KEY_PREVIOUS"));
  return (cachedKeys = keys);
}

/** The key new secrets are written with, or null when the vault is disabled. */
function key(): Buffer | null {
  return vaultKeys()[0]?.bytes ?? null;
}

export function secretsEnabled(): boolean {
  return key() !== null;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: string;
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
  if (!k) throw badInput("credential storage disabled: set TACHY_SECRET_KEY");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, k, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce, keyId: keyId(k) };
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
    key_id?: string | null;
  },
  aad?: string,
): string {
  const keys = vaultKeys();
  if (!keys.length)
    throw badInput("credential storage disabled: set TACHY_SECRET_KEY");
  // A row names its key; one written before key ids is tried with each.
  const candidates = row.key_id
    ? keys.filter((k) => k.id === row.key_id)
    : keys;
  if (!candidates.length)
    throw badInput(
      `no key with id ${row.key_id} is configured; add it to TACHY_SECRET_KEY_PREVIOUS`,
    );
  let last: unknown;
  for (const k of candidates) {
    for (const withAad of aad ? [aad, undefined] : [undefined]) {
      try {
        return open(k.bytes, row, withAad);
      } catch (err) {
        last = err;
      }
    }
  }
  throw last;
}

/** Test hook: re-read the key environment on next use. */
export function clearSecretKeyCache(): void {
  cachedKeys = undefined;
}
