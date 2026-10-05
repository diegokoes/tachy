import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("../../packages/web/src/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api: { get, put: vi.fn(), delete: vi.fn() },
}));

const { agentPrefs, loadAgent, origin } =
  await import("../../packages/web/src/settings/prefs.svelte");

const prefs = () => ({
  agent_model: { value: "m", source: "user" },
  agent_effort: { value: "medium", source: "default" },
  date_order: { value: "dmy", source: "default" },
  clock: { value: "24h", source: "default" },
});

describe("origin", () => {
  it("says nothing when no value is set anywhere", () => {
    expect(origin(null, "key")).toBeNull();
  });

  it("marks your own value", () => {
    expect(origin("user", "default")).toEqual({ label: "yours", mine: true });
    expect(origin("user", "key")).toEqual({ label: "yours", mine: true });
  });

  it("names who set an inherited value, the same way for settings and the vault", () => {
    expect(origin("db", "default")?.label).toBe("org default");
    expect(origin("global", "key")?.label).toBe("org key");
    expect(origin("team", "default")).toMatchObject({
      label: "team default",
      mine: false,
    });
    expect(origin("env", "key")?.label).toBe("server key");
    expect(origin("default", "default")?.label).toBe("built-in default");
  });
});

describe("loadAgent", () => {
  beforeEach(() => {
    get.mockReset();
    agentPrefs.models = null;
    agentPrefs.error = null;
  });

  function serve() {
    get.mockImplementation(async (path: string) => {
      if (path === "/me/preferences") return prefs();
      if (path === "/me/credentials")
        return { vault_enabled: true, mine: [], effective: {}, agent: {} };
      if (path === "/me/models")
        return { models: [], restricted: false, error: null };
      throw new Error(path);
    });
  }
  const modelCalls = () =>
    get.mock.calls.filter(([p]) => p === "/me/models").length;

  it("asks the runtime for its models once, not on every reload", async () => {
    serve();
    await loadAgent();
    await vi.waitFor(() => expect(agentPrefs.models).not.toBeNull());
    await loadAgent();
    expect(modelCalls()).toBe(1);
  });

  it("keeps the preferences when the model list fails", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/me/models") throw new Error("no runtime");
      if (path === "/me/preferences") return prefs();
      return { vault_enabled: true, mine: [], effective: {}, agent: {} };
    });
    await loadAgent();
    await vi.waitFor(() => expect(agentPrefs.modelsLoading).toBe(false));
    expect(agentPrefs.prefs?.agent_model.value).toBe("m");
    expect(agentPrefs.models).toBeNull();
    expect(agentPrefs.error).toBe("no runtime");
  });
});
