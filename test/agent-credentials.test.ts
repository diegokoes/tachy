import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  setCredential,
  setPref,
  effectiveSettings,
  resolveAgentAuth,
  ANTHROPIC_OAUTH_CREDENTIAL,
  validateCredential,
} from "@tachy/core";
import { mcpConfig } from "../packages/api/src/routes/agent";
import { enableVault, resetData, sql } from "./helpers";

const agentHome = mkdtempSync(join(tmpdir(), "tachy-agent-home-"));
process.env.TACHY_AGENT_HOME = agentHome;

afterAll(() => {
  rmSync(agentHome, { recursive: true, force: true });
  return sql.end();
});

const TOKEN_VAR = "FRESHDESK_TOKEN_TEST_FRESHDESK";
const OAUTH = "sk-ant-oat01-alice-seat-token";

describe("per-turn agent config isolation (cross-user token safety)", () => {
  let alice: { id: string };
  let bob: { id: string };

  beforeAll(async () => {
    await resetData();
    await sql`truncate credentials, preferences cascade`;
    enableVault();
    delete process.env[TOKEN_VAR];

    alice = await createUser({
      email: "alice@example.com",
      password: "a-long-password",
    });
    bob = await createUser({
      email: "bob@example.com",
      password: "a-long-password",
    });
    await setCredential(
      alice.id,
      "user",
      alice.id,
      "freshdesk_token:test-freshdesk",
      "alice-token",
    );
    await setCredential(
      bob.id,
      "user",
      bob.id,
      "freshdesk_token:test-freshdesk",
      "bob-token",
    );
    await setCredential(
      alice.id,
      "user",
      alice.id,
      "anthropic_api_key",
      "sk-ant-api03-alice",
    );
  });

  it("materializes each caller's own source token into a fresh mcpEnv", async () => {
    const settings = await effectiveSettings();
    const aliceCfg = await mcpConfig("alice@example.com", settings);
    expect(aliceCfg.mcpEnv[TOKEN_VAR]).toBe("alice-token");
    expect(aliceCfg.mcpEnv.TACHY_USER_EMAIL).toBe("alice@example.com");
    expect(aliceCfg.agentAuth).toMatchObject({
      kind: "anthropic_api_key",
      value: "sk-ant-api03-alice",
    });

    aliceCfg.mcpEnv[TOKEN_VAR] = "tampered";
    const bobCfg = await mcpConfig("bob@example.com", settings);
    expect(bobCfg.mcpEnv[TOKEN_VAR]).toBe("bob-token");
    expect(bobCfg.mcpEnv.TACHY_USER_EMAIL).toBe("bob@example.com");
    expect(bobCfg.agentAuth).toBeUndefined();
    expect(bobCfg.mcpEnv).not.toBe(aliceCfg.mcpEnv);
  });

  it("a caller without a token gets no injected value (sourceToken() then fails clearly)", async () => {
    const settings = await effectiveSettings();
    const carol = await createUser({
      email: "carol@example.com",
      password: "a-long-password",
    });
    void carol;
    const cfg = await mcpConfig("carol@example.com", settings);
    expect(cfg.mcpEnv[TOKEN_VAR]).toBeUndefined();
  });

  it("per-user provider preference selects the backend for that turn only", async () => {
    const settings = await effectiveSettings();
    await setPref(bob.id, "user", bob.id, "agent_provider", "copilot");
    await setCredential(bob.id, "user", bob.id, "copilot_token", "bob-gh");

    const bobCfg = await mcpConfig("bob@example.com", settings);
    expect(bobCfg.provider).toBe("copilot");
    expect(bobCfg.agentAuth).toMatchObject({
      kind: "copilot_token",
      value: "bob-gh",
    });

    const aliceCfg = await mcpConfig("alice@example.com", settings);
    expect(aliceCfg.provider).toBe("claude");
    expect(aliceCfg.agentAuth).toMatchObject({
      kind: "anthropic_api_key",
      value: "sk-ant-api03-alice",
    });
  });

  it("gives each caller their own config dir, so logins and transcripts never mix", async () => {
    const settings = await effectiveSettings();
    const aliceCfg = await mcpConfig("alice@example.com", settings);
    const bobCfg = await mcpConfig("bob@example.com", settings);

    expect(aliceCfg.configDir).toContain(alice.id);
    expect(bobCfg.configDir).toContain(bob.id);
    expect(aliceCfg.configDir).not.toBe(bobCfg.configDir);
    expect(existsSync(aliceCfg.configDir!)).toBe(true);
    expect(statSync(aliceCfg.configDir!).mode & 0o777).toBe(0o700);
  });

  it("is stable across turns for the same user (a new dir would orphan transcripts)", async () => {
    const settings = await effectiveSettings();
    const first = await mcpConfig("alice@example.com", settings);
    const second = await mcpConfig("alice@example.com", settings);
    expect(first.configDir).toBe(second.configDir);
  });
});

describe("Claude credential selection (API key vs subscription token)", () => {
  let dana: { id: string };
  let admin: { id: string };

  beforeAll(async () => {
    await resetData();
    await sql`truncate credentials, preferences cascade`;
    enableVault();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    dana = await createUser({
      email: "dana@example.com",
      password: "a-long-password",
    });
    admin = await createUser({
      email: "admin@example.com",
      password: "a-long-password",
      role: "admin",
    });
  });

  it("uses a user's own subscription token", async () => {
    await setCredential(
      dana.id,
      "user",
      dana.id,
      ANTHROPIC_OAUTH_CREDENTIAL,
      OAUTH,
    );
    expect(await resolveAgentAuth("claude", { userId: dana.id })).toMatchObject(
      {
        kind: "anthropic_oauth",
        value: OAUTH,
        source: "user",
      },
    );
  });

  it("prefers a user's token over an org-wide API key", async () => {
    await setCredential(
      admin.id,
      "global",
      undefined,
      "anthropic_api_key",
      "sk-ant-api03-org-wide",
    );
    expect(await resolveAgentAuth("claude", { userId: dana.id })).toMatchObject(
      {
        kind: "anthropic_oauth",
        source: "user",
      },
    );
  });

  it("falls back to the org key for a user with nothing of their own", async () => {
    const eve = await createUser({
      email: "eve@example.com",
      password: "a-long-password",
    });
    expect(await resolveAgentAuth("claude", { userId: eve.id })).toMatchObject({
      kind: "anthropic_api_key",
      value: "sk-ant-api03-org-wide",
      source: "global",
    });
  });

  it("prefers an API key over a token at the same scope", async () => {
    const frank = await createUser({
      email: "frank@example.com",
      password: "a-long-password",
    });
    await setCredential(
      frank.id,
      "user",
      frank.id,
      ANTHROPIC_OAUTH_CREDENTIAL,
      OAUTH,
    );
    await setCredential(
      frank.id,
      "user",
      frank.id,
      "anthropic_api_key",
      "sk-ant-api03-frank",
    );
    expect(
      await resolveAgentAuth("claude", { userId: frank.id }),
    ).toMatchObject({ kind: "anthropic_api_key", source: "user" });
  });
});

describe("credential shape validation", () => {
  it("rejects a subscription token saved as an API key", () => {
    expect(validateCredential("anthropic_api_key", OAUTH)).toMatch(
      /not an API key/,
    );
  });

  it("rejects an API key saved as a subscription token", () => {
    expect(
      validateCredential(ANTHROPIC_OAUTH_CREDENTIAL, "sk-ant-api03-abc"),
    ).toMatch(/starts with sk-ant-oat01-/);
  });

  it("rejects a value that is no kind of Anthropic key at all", () => {
    for (const value of ["hunter2", "", "sk-ant-api03-a b"])
      expect(validateCredential("anthropic_api_key", value)).toMatch(
        /starts with sk-ant-api03-/,
      );
  });

  it("accepts each in its own field", () => {
    expect(validateCredential(ANTHROPIC_OAUTH_CREDENTIAL, OAUTH)).toBeNull();
    expect(
      validateCredential("anthropic_api_key", "sk-ant-api03-abc"),
    ).toBeNull();
  });

  it("leaves credentials it has no shape for alone", () => {
    expect(validateCredential("copilot_token", "ghu_whatever")).toBeNull();
    expect(
      validateCredential("freshdesk_token:acme", "anything at all"),
    ).toBeNull();
  });

  it("is enforced inside setCredential, not only at the route", async () => {
    await resetData();
    enableVault();
    const gus = await createUser({
      email: "gus@example.com",
      password: "a-long-password",
    });
    await expect(
      setCredential(gus.id, "user", gus.id, "anthropic_api_key", OAUTH),
    ).rejects.toThrow(/not an API key/);
  });
});

describe("server-env credential is the lowest rung (deployment-wide fallback)", () => {
  let user: { id: string };
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    await resetData();
    await sql`truncate credentials, preferences cascade`;
    enableVault();
    process.env.ANTHROPIC_API_KEY = "server-env-key";
    user = await createUser({
      email: "heidi@example.com",
      password: "a-long-password",
    });
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("answers for a user who has nothing of their own", async () => {
    expect(await resolveAgentAuth("claude", { userId: user.id })).toMatchObject(
      {
        kind: "anthropic_api_key",
        value: "server-env-key",
        source: "env",
      },
    );
  });

  it("loses to that user's own subscription token", async () => {
    await setCredential(
      user.id,
      "user",
      user.id,
      ANTHROPIC_OAUTH_CREDENTIAL,
      OAUTH,
    );
    expect(await resolveAgentAuth("claude", { userId: user.id })).toMatchObject(
      {
        kind: "anthropic_oauth",
        source: "user",
      },
    );
  });
});
