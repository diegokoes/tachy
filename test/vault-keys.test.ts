import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  keyId,
  resolveCredential,
  rotateVaultKey,
  setCredential,
  vaultKeys,
  vaultState,
} from "@tachy/core";
import { clearSecretKeyCache } from "../packages/core/src/infra/secrets";
import { resetData, sql } from "./helpers";

afterAll(() => {
  delete process.env.TACHY_SECRET_KEY;
  delete process.env.TACHY_SECRET_KEY_PREVIOUS;
  clearSecretKeyCache();
  return sql.end();
});

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const idOf = (k: string) => keyId(Buffer.from(k, "base64"));

function useKeys(current: string, previous?: string) {
  process.env.TACHY_SECRET_KEY = current;
  if (previous) process.env.TACHY_SECRET_KEY_PREVIOUS = previous;
  else delete process.env.TACHY_SECRET_KEY_PREVIOUS;
  clearSecretKeyCache();
}

beforeEach(async () => {
  await resetData();
  await sql`truncate credentials`;
  useKeys(KEY_A);
});

describe("vault key ids", () => {
  it("stamps each credential with the key that wrote it", async () => {
    const admin = await createUser({
      email: "vault-admin@example.com",
      role: "admin",
    });
    await setCredential(
      admin.id,
      "global",
      undefined,
      "anthropic_api_key",
      "sk-ant-a-long-key",
    );
    const [row] = await sql`select key_id from credentials`;
    expect(row.key_id).toBe(idOf(KEY_A));
    expect(await vaultState()).toMatchObject({
      enabled: true,
      current_key: idOf(KEY_A),
      by_key: [{ key_id: idOf(KEY_A), count: 1, current: true }],
    });
  });

  it("opens old rows with a previous key, and rotate-key moves them over", async () => {
    const admin = await createUser({
      email: "vault-admin@example.com",
      role: "admin",
    });
    await setCredential(
      admin.id,
      "global",
      undefined,
      "anthropic_api_key",
      "sk-ant-a-long-key",
    );

    // Rotate: the new key is current, the old one only opens what it wrote.
    useKeys(KEY_B, KEY_A);
    expect(vaultKeys().map((k) => k.id)).toEqual([idOf(KEY_B), idOf(KEY_A)]);
    expect(await resolveCredential("anthropic_api_key", {})).toBe(
      "sk-ant-a-long-key",
    );
    expect(await vaultState()).toMatchObject({
      current_key: idOf(KEY_B),
      by_key: [{ key_id: idOf(KEY_A), count: 1, current: false }],
    });

    expect(await rotateVaultKey()).toEqual({ moved: 1, already: 0 });
    const [row] = await sql`select key_id from credentials`;
    expect(row.key_id).toBe(idOf(KEY_B));

    // The old key can now be dropped and the credential still opens.
    useKeys(KEY_B);
    expect(await resolveCredential("anthropic_api_key", {})).toBe(
      "sk-ant-a-long-key",
    );
    expect(await rotateVaultKey()).toEqual({ moved: 0, already: 1 });
  });

  it("says which key is missing instead of failing blindly", async () => {
    const admin = await createUser({
      email: "vault-admin@example.com",
      role: "admin",
    });
    await setCredential(
      admin.id,
      "global",
      undefined,
      "anthropic_api_key",
      "sk-ant-a-long-key",
    );
    useKeys(KEY_B);
    await expect(resolveCredential("anthropic_api_key", {})).rejects.toThrow(
      new RegExp(`no key with id ${idOf(KEY_A)}`),
    );
  });
});
