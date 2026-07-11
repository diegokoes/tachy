import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  addTeam,
  setTeamMember,
  getTeamIdBySlug,
  resolveScoped,
  resolveCredential,
  credentialSource,
  setCredential,
  deleteCredential,
  listCredentials,
  setPref,
  resolvePref,
  setSetting,
  clearSettingsCache,
} from "@tachy/core";
import {
  encryptSecret,
  decryptSecret,
  secretsEnabled,
  clearSecretKeyCache,
} from "../packages/core/src/infra/secrets";
import { createApp } from "../packages/api/src/app";
import {
  enableVault,
  disableVault,
  loginCookie,
  resetData,
  sql,
} from "./helpers";

afterAll(() => sql.end());

async function seedPeople() {
  const admin = await createUser({
    email: "root@example.com",
    password: "a-long-password",
    role: "admin",
  });
  const alice = await createUser({
    email: "alice@example.com",
    password: "a-long-password",
  });
  const bob = await createUser({
    email: "bob@example.com",
    password: "a-long-password",
  });
  await addTeam("hw", "Hardware");
  const teamId = await getTeamIdBySlug("hw");
  await setTeamMember("hw", "alice@example.com", "admin");
  await setTeamMember("hw", "bob@example.com", "member");
  return { admin, alice, bob, teamId };
}

beforeEach(async () => {
  await resetData();
  await sql`truncate credentials, preferences cascade`;
  enableVault();
});

describe("secrets (AES-256-GCM)", () => {
  it("roundtrips and stores opaque bytes", () => {
    const enc = encryptSecret("sk-ant-secret");
    expect(enc.ciphertext.toString("utf8")).not.toContain("sk-ant");
    expect(
      decryptSecret({ value_ciphertext: enc.ciphertext, nonce: enc.nonce }),
    ).toBe("sk-ant-secret");
  });

  it("is disabled without TACHY_SECRET_KEY and falls through to env", async () => {
    disableVault();
    expect(secretsEnabled()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/disabled/);
    process.env.ANTHROPIC_API_KEY = "env-key";
    try {
      expect(await resolveCredential("anthropic_api_key", {})).toBe("env-key");
      expect(await credentialSource("anthropic_api_key", {})).toBe("env");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("rejects a malformed key", () => {
    process.env.TACHY_SECRET_KEY = "tooshort";
    clearSecretKeyCache();
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    enableVault();
  });
});

describe("scoped credential resolution (user > team > global > env)", () => {
  it("walks the scopes most-specific first and falls back rung by rung", async () => {
    const { admin, alice, teamId } = await seedPeople();
    const ctx = { userId: alice.id, teamId };

    process.env.ANTHROPIC_API_KEY = "env-key";
    try {
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("env-key");

      await setCredential(admin.id, "global", undefined, "anthropic_api_key", "global-key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("global-key");

      await setCredential(alice.id, "team", teamId, "anthropic_api_key", "team-key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("team-key");

      await setCredential(alice.id, "user", alice.id, "anthropic_api_key", "user-key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("user-key");
      expect(await credentialSource("anthropic_api_key", ctx)).toBe("user");

      await deleteCredential(alice.id, "user", alice.id, "anthropic_api_key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("team-key");

      await deleteCredential(alice.id, "team", teamId, "anthropic_api_key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("global-key");

      await deleteCredential(admin.id, "global", undefined, "anthropic_api_key");
      expect(await resolveCredential("anthropic_api_key", ctx)).toBe("env-key");
      expect(await credentialSource("anthropic_api_key", ctx)).toBe("env");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("upserts instead of duplicating within one scope", async () => {
    const { alice } = await seedPeople();
    await setCredential(alice.id, "user", alice.id, "copilot_token", "one");
    await setCredential(alice.id, "user", alice.id, "copilot_token", "two");
    expect(await resolveCredential("copilot_token", { userId: alice.id })).toBe("two");
    expect(await listCredentials("user", alice.id)).toHaveLength(1);
  });

  it("resolves source-token names through the env fallback", async () => {
    process.env.FRESHDESK_TOKEN_MY_CONN = "fd-token";
    try {
      expect(await resolveCredential("freshdesk_token:my-conn", {})).toBe("fd-token");
    } finally {
      delete process.env.FRESHDESK_TOKEN_MY_CONN;
    }
  });
});

describe("write authorization matrix", () => {
  it("a plain member cannot write team or global credentials", async () => {
    const { bob, teamId } = await seedPeople();
    await expect(
      setCredential(bob.id, "team", teamId, "anthropic_api_key", "x"),
    ).rejects.toThrow(/admin rights/);
    await expect(
      setCredential(bob.id, "global", undefined, "anthropic_api_key", "x"),
    ).rejects.toThrow(/global admin/);
  });

  it("a team admin can write team but not global", async () => {
    const { alice, teamId } = await seedPeople();
    await setCredential(alice.id, "team", teamId, "anthropic_api_key", "x");
    await expect(
      setCredential(alice.id, "global", undefined, "anthropic_api_key", "x"),
    ).rejects.toThrow(/global admin/);
  });

  it("a user cannot write another user's row", async () => {
    const { alice, bob } = await seedPeople();
    await expect(
      setCredential(bob.id, "user", alice.id, "anthropic_api_key", "x"),
    ).rejects.toThrow(/your own/);
  });

  it("a demoted team admin loses write rights immediately (no 60s window)", async () => {
    const { alice, teamId } = await seedPeople();
    await setCredential(alice.id, "team", teamId, "anthropic_api_key", "x");
    await setTeamMember("hw", "alice@example.com", "member");
    await expect(
      setCredential(alice.id, "team", teamId, "anthropic_api_key", "y"),
    ).rejects.toThrow(/admin rights/);
  });
});

describe("schema constraints", () => {
  it("rejects scope rows whose FK disagrees with the scope", async () => {
    await expect(
      sql`insert into credentials (scope, name, value_ciphertext, nonce)
          values ('team', 'x', '\\x00'::bytea, '\\x00'::bytea)`,
    ).rejects.toThrow(/check/i);
    const { alice } = await seedPeople();
    await expect(
      sql`insert into credentials (scope, user_id, name, value_ciphertext, nonce)
          values ('global', ${alice.id}, 'x', '\\x00'::bytea, '\\x00'::bytea)`,
    ).rejects.toThrow(/check/i);
  });
});

describe("resolveScoped (the shared walk)", () => {
  it("returns the most specific row and which scope won", async () => {
    const { admin, alice, teamId } = await seedPeople();
    const ctx = { userId: alice.id, teamId };

    expect(await resolveScoped("preferences", "agent_model", ctx)).toBeUndefined();

    await setPref(admin.id, "global", undefined, "agent_model", "g");
    expect((await resolveScoped("preferences", "agent_model", ctx))?.scope).toBe(
      "global",
    );

    await setPref(alice.id, "team", teamId, "agent_model", "t");
    expect((await resolveScoped("preferences", "agent_model", ctx))?.scope).toBe(
      "team",
    );

    await setPref(alice.id, "user", alice.id, "agent_model", "u");
    const hit = await resolveScoped("preferences", "agent_model", ctx);
    expect(hit?.scope).toBe("user");
    expect(hit?.row.value).toBe("u");
  });

  it("ignores other users' and other teams' rows", async () => {
    const { admin, alice, bob, teamId } = await seedPeople();
    void admin;
    await setPref(bob.id, "user", bob.id, "agent_model", "bobs");
    expect(
      await resolveScoped("preferences", "agent_model", {
        userId: alice.id,
        teamId,
      }),
    ).toBeUndefined();
    expect(
      await resolveScoped("preferences", "agent_model", { userId: bob.id }),
    ).toMatchObject({ scope: "user" });
  });
});

describe("scoped preferences", () => {
  it("user pref beats team pref beats global setting", async () => {
    const { admin, alice, teamId } = await seedPeople();
    const ctx = { userId: alice.id, teamId };

    clearSettingsCache();
    expect((await resolvePref("agent_provider", ctx)).value).toBe("claude");

    await setSetting("agent_provider", "copilot");
    clearSettingsCache();
    expect(await resolvePref("agent_provider", ctx)).toMatchObject({
      value: "copilot",
      source: "db",
    });

    await setPref(alice.id, "team", teamId, "agent_provider", "claude");
    expect(await resolvePref("agent_provider", ctx)).toMatchObject({
      value: "claude",
      source: "team",
    });

    await setPref(alice.id, "user", alice.id, "agent_provider", "copilot");
    expect(await resolvePref("agent_provider", ctx)).toMatchObject({
      value: "copilot",
      source: "user",
    });

    await expect(
      setPref(admin.id, "user", alice.id, "agent_provider", "claude"),
    ).rejects.toThrow(/your own/);
    await expect(
      setPref(alice.id, "user", alice.id, "agent_provider", "gpt"),
    ).rejects.toThrow(/invalid value/);
  });
});

describe("API never leaks plaintext or ciphertext", () => {
  const app = createApp({ passwordAuth: true });

  const login = (email: string) =>
    loginCookie(app, email, "a-long-password");

  it("stores via /me and /credentials, lists only metadata", async () => {
    const { admin, alice } = await seedPeople();
    void admin;
    const cookie = await login("alice@example.com");
    const adminCookie = await login("root@example.com");

    const put = await app.request("/api/me/credentials/anthropic_api_key", {
      method: "PUT",
      body: JSON.stringify({ value: "super-secret-user-key" }),
      headers: { "Content-Type": "application/json", cookie },
    });
    expect(put.status).toBe(200);

    const putGlobal = await app.request("/api/credentials", {
      method: "PUT",
      body: JSON.stringify({
        scope: "global",
        name: "copilot_token",
        value: "super-secret-global-token",
      }),
      headers: { "Content-Type": "application/json", cookie: adminCookie },
    });
    expect(putGlobal.status).toBe(200);

    for (const [path, c] of [
      ["/api/me/credentials", cookie],
      ["/api/me/preferences", cookie],
      ["/api/credentials?scope=global", adminCookie],
      ["/api/system", adminCookie],
    ] as const) {
      const res = await app.request(path, { headers: { cookie: c } });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("super-secret");
      expect(text).not.toContain("ciphertext");
    }

    const mine = await app.request("/api/me/credentials", {
      headers: { cookie },
    });
    const body = (await mine.json()) as {
      mine: { name: string }[];
      effective: Record<string, string | null>;
    };
    expect(body.mine.map((m) => m.name)).toContain("anthropic_api_key");
    expect(body.effective.anthropic_api_key).toBe("user");
    expect(body.effective.copilot_token).toBe("global");
  });

  it("a member cannot use the admin credentials routes", async () => {
    await seedPeople();
    const cookie = await login("bob@example.com");
    const res = await app.request("/api/credentials?scope=global", {
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });

  it("me preferences round-trip: PUT overrides, DELETE falls back", async () => {
    await seedPeople();
    const cookie = await login("alice@example.com");
    const headers = { "Content-Type": "application/json", cookie };

    const put = await app.request("/api/me/preferences/agent_provider", {
      method: "PUT",
      body: JSON.stringify({ value: "copilot" }),
      headers,
    });
    expect(put.status).toBe(200);
    let prefs = await (
      await app.request("/api/me/preferences", { headers: { cookie } })
    ).json();
    expect(prefs.agent_provider).toMatchObject({
      value: "copilot",
      source: "user",
    });

    const bad = await app.request("/api/me/preferences/agent_provider", {
      method: "PUT",
      body: JSON.stringify({ value: "gpt" }),
      headers,
    });
    expect(bad.status).toBe(400);

    const del = await app.request("/api/me/preferences/agent_provider", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ deleted: true });
    prefs = await (
      await app.request("/api/me/preferences", { headers: { cookie } })
    ).json();
    expect(prefs.agent_provider.value).toBe("claude");
    expect(prefs.agent_provider.source).not.toBe("user");
  });

  it("me credentials DELETE removes the override and falls back", async () => {
    const { admin } = await seedPeople();
    await setCredential(
      admin.id,
      "global",
      undefined,
      "anthropic_api_key",
      "global-key",
    );
    const cookie = await login("alice@example.com");
    const headers = { "Content-Type": "application/json", cookie };

    await app.request("/api/me/credentials/anthropic_api_key", {
      method: "PUT",
      body: JSON.stringify({ value: "alices-key" }),
      headers,
    });
    let body = await (
      await app.request("/api/me/credentials", { headers: { cookie } })
    ).json();
    expect(body.effective.anthropic_api_key).toBe("user");

    const del = await app.request("/api/me/credentials/anthropic_api_key", {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    body = await (
      await app.request("/api/me/credentials", { headers: { cookie } })
    ).json();
    expect(body.effective.anthropic_api_key).toBe("global");
    expect(body.mine).toEqual([]);
  });
});
