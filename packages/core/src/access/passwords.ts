import { MIN_PASSWORD_LENGTH } from "@tachy/contract";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { badInput } from "../infra/errors";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's password storage setting for scrypt: N=2^17, r=8, p=1. */
const SCRYPT_COST = 2 ** 17;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEYLEN = 64;
/** scrypt needs 128 * N * r bytes; Node refuses a hash whose need exceeds this. */
const MAXMEM = 256 * 1024 * 1024;

// Owned by the contract: the wizard checks it in the field, this checks it again.
export { MIN_PASSWORD_LENGTH };

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw badInput(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: MAXMEM,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

let placeholderHash: Promise<string> | undefined;

/** True when the hash was made at a lower cost than new ones are. */
export function isWeakerHash(stored: string): boolean {
  const [scheme, cost] = stored.split("$");
  return scheme === "scrypt" && Number(cost) < SCRYPT_COST;
}

/**
 * An account with no hash is checked against a placeholder, so the answer
 * takes as long as a wrong password does and timing does not say which
 * addresses have an account.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) {
    placeholderHash ??= hashPassword(randomBytes(24).toString("base64"));
    await verifyPassword(password, await placeholderHash);
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, cost, blockSize, parallelism, saltB64, hashB64] = parts;
  const want = Buffer.from(hashB64, "base64");
  const got = await scrypt(
    password,
    Buffer.from(saltB64, "base64"),
    want.length,
    {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelism),
      maxmem: MAXMEM,
    },
  );
  return got.length === want.length && timingSafeEqual(got, want);
}
