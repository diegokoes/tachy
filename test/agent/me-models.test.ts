import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSettingsCache, setSetting } from "@tachy/core/config";
import { createUser } from "@tachy/core/access";
import type { ModelChoice, ModelListConfig } from "@tachy/agent";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData, sql } from "../database";

const listModels = vi.fn<(cfg: ModelListConfig) => Promise<ModelChoice[]>>();
vi.mock("@tachy/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tachy/agent")>()),
  listModels: (cfg: ModelListConfig) => listModels(cfg),
}));

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

const OFFERED: ModelChoice[] = [
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    efforts: ["low", "medium", "high"],
  },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", efforts: [] },
];

async function models() {
  const cookie = await loginCookie(app, "ada@example.com", "a-long-password");
  const res = await app.request("/api/me/models", { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(async () => {
  await resetData();
  await sql`truncate preferences cascade`;
  await sql`delete from settings where key = 'allowed_models'`;
  clearSettingsCache();
  listModels.mockReset();
  await createUser({ email: "ada@example.com", password: "a-long-password" });
});

describe("GET /me/models", () => {
  it("returns what the caller's runtime offers, for their provider", async () => {
    listModels.mockResolvedValue(OFFERED);
    const body = await models();
    expect(body).toMatchObject({
      provider: "claude",
      models: OFFERED,
      restricted: false,
      error: null,
    });
    expect(listModels.mock.calls[0][0].provider).toBe("claude");
  });

  it("holds the list to the org's allow-list, keeping allowed ids it cannot describe", async () => {
    await setSetting("allowed_models", ["claude-opus-5-5", "claude-sonnet-5"]);
    clearSettingsCache();
    listModels.mockResolvedValue(OFFERED);
    const body = await models();
    expect(body.restricted).toBe(true);
    expect(body.models.map((m: ModelChoice) => m.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5",
    ]);
    expect(body.models[1].efforts).toContain("max");
  });

  it("reports a runtime that cannot be asked instead of failing the request", async () => {
    listModels.mockRejectedValue(new Error("runtime unavailable"));
    const body = await models();
    expect(body.models).toEqual([]);
    expect(body.error).toBe("runtime unavailable");
  });
});
