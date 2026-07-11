import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  setCredential,
  setPref,
  effectiveSettings,
} from "@tachy/core";
import { mcpConfig } from "../packages/api/src/routes/agent";
import { enableVault, resetData, sql } from "./helpers";

afterAll(() => sql.end());

const TOKEN_VAR = "FRESHDESK_TOKEN_TEST_FRESHDESK";

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
      "alice-anthropic-key",
    );
  });

  it("materializes each caller's own source token into a fresh mcpEnv", async () => {
    const settings = await effectiveSettings();
    const aliceCfg = await mcpConfig("alice@example.com", settings);
    expect(aliceCfg.mcpEnv[TOKEN_VAR]).toBe("alice-token");
    expect(aliceCfg.mcpEnv.TACHY_USER_EMAIL).toBe("alice@example.com");
    expect(aliceCfg.agentKey).toBe("alice-anthropic-key");

    aliceCfg.mcpEnv[TOKEN_VAR] = "tampered";
    const bobCfg = await mcpConfig("bob@example.com", settings);
    expect(bobCfg.mcpEnv[TOKEN_VAR]).toBe("bob-token");
    expect(bobCfg.mcpEnv.TACHY_USER_EMAIL).toBe("bob@example.com");
    expect(bobCfg.agentKey).toBeUndefined();
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
    expect(bobCfg.agentKey).toBe("bob-gh");

    const aliceCfg = await mcpConfig("alice@example.com", settings);
    expect(aliceCfg.provider).toBe("claude");
    expect(aliceCfg.agentKey).toBe("alice-anthropic-key");
  });
});
