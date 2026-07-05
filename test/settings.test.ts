import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../packages/api/src/app";
import {
  getSettings, setSetting, effectiveSettings, clearSettingsCache, createUser, AppError,
} from "@tachy/core";
import { resetData, sql } from "./helpers";

afterAll(() => sql.end());

describe("settings store", () => {
  beforeAll(async () => {
    await resetData();
    // the precedence assertions need a clean slate regardless of the dev shell
    delete process.env.TACHY_AGENT_MODEL;
    delete process.env.TACHY_AGENT_EFFORT;
    delete process.env.TACHY_ALLOWED_MODELS;
    delete process.env.TACHY_REDACT;
  });
  afterEach(() => {
    clearSettingsCache();
    delete process.env.TACHY_AGENT_MODEL;
    delete process.env.TACHY_REDACT;
  });

  it("set/get roundtrip with validation", async () => {
    await setSetting("agent_model", "claude-opus-4-8");
    await setSetting("redaction_global", true);
    clearSettingsCache();
    expect(await getSettings()).toMatchObject({ agent_model: "claude-opus-4-8", redaction_global: true });
  });

  it("rejects unknown keys and invalid values", async () => {
    await expect(setSetting("nope", 1)).rejects.toThrow(AppError);
    await expect(setSetting("agent_effort", "turbo")).rejects.toThrow(AppError);
    await expect(setSetting("allowed_models", "not-an-array")).rejects.toThrow(AppError);
  });

  it("precedence: db > env > default", async () => {
    await sql`delete from settings`;
    clearSettingsCache();

    // default
    let eff = await effectiveSettings();
    expect(eff.agent_model).toEqual({ value: "claude-sonnet-5", source: "default" });

    // env fallback
    process.env.TACHY_AGENT_MODEL = "claude-haiku-4-5";
    clearSettingsCache();
    eff = await effectiveSettings();
    expect(eff.agent_model).toEqual({ value: "claude-haiku-4-5", source: "env" });

    // db wins
    await setSetting("agent_model", "claude-opus-4-8");
    eff = await effectiveSettings();
    expect(eff.agent_model).toEqual({ value: "claude-opus-4-8", source: "db" });
  });
});

describe("settings API gating", () => {
  const app = createApp({ passwordAuth: true });
  const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    await resetData();
    await createUser({ email: "boss@example.com", password: "admin-password", role: "admin" });
    await createUser({ email: "dev@example.com", password: "member-password", role: "member" });
    const login = async (email: string, password: string) => {
      const res = await app.request("/auth/password/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        headers: { "Content-Type": "application/json" },
      });
      return cookieOf(res);
    };
    adminCookie = await login("boss@example.com", "admin-password");
    memberCookie = await login("dev@example.com", "member-password");
  });

  const put = (cookie: string, key: string, value: unknown) =>
    app.request(`/api/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
      headers: { "Content-Type": "application/json", cookie },
    });

  it("members read /system but cannot write settings", async () => {
    const read = await app.request("/api/system", { headers: { cookie: memberCookie } });
    expect(read.status).toBe(200);
    const res = await put(memberCookie, "agent_effort", "low");
    expect(res.status).toBe(403);
  });

  it("admins write settings; /system reflects the db source", async () => {
    const res = await put(adminCookie, "agent_effort", "xhigh");
    expect(res.status).toBe(200);

    const sys = await app.request("/api/system", { headers: { cookie: adminCookie } });
    const body = await sys.json();
    expect(body.settings.agent_effort).toEqual({ value: "xhigh", source: "db" });
    expect(body.env).not.toHaveProperty("api_token"); // no secret values, only *_set booleans
    expect(body.env.api_token_set).toBe(false);
  });

  it("rejects invalid settings with 400", async () => {
    const bad = await put(adminCookie, "agent_effort", "turbo");
    expect(bad.status).toBe(400);
    const unknown = await put(adminCookie, "warp_drive", true);
    expect(unknown.status).toBe(400);
  });
});
