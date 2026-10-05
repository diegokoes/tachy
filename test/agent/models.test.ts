import { afterEach, describe, expect, it, vi } from "vitest";

const claude = vi.hoisted(() => ({
  supportedModels: vi.fn(),
  close: vi.fn(),
  options: [] as Record<string, unknown>[],
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: ({ options }: { options: Record<string, unknown> }) => {
    claude.options.push(options);
    return { supportedModels: claude.supportedModels, close: claude.close };
  },
}));

const { listModels } = await import("../../packages/agent/src/models");

let n = 0;
const auth = () => ({
  kind: "anthropic_api_key" as const,
  value: `secret-${++n}`,
});

afterEach(() => {
  vi.useRealTimers();
  claude.supportedModels.mockReset();
  claude.close.mockReset();
  claude.options.length = 0;
});

describe("listModels", () => {
  it("names models by their wire id and keeps only the efforts tachy knows", async () => {
    claude.supportedModels.mockResolvedValue([
      {
        value: "default",
        resolvedModel: "claude-opus-5-5",
        displayName: "Default (recommended)",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
      {
        value: "opus",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus 5.5",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["max", "low", "turbo"],
      },
      { value: "claude-haiku-4-5", displayName: "", description: "" },
      { value: "default", displayName: "Default", description: "" },
    ]);
    const models = await listModels({ agentAuth: auth() });
    expect(models).toEqual([
      { id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "max"] },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5", efforts: [] },
    ]);
    expect(claude.close).toHaveBeenCalled();
  });

  it("asks with the caller's credential and no settings from disk", async () => {
    claude.supportedModels.mockResolvedValue([]);
    const a = auth();
    await listModels({
      agentAuth: a,
      configDir: "/tmp/u1",
    });
    const opts = claude.options[0] as {
      env: Record<string, string>;
      settingSources: unknown[];
    };
    expect(opts.env.ANTHROPIC_API_KEY).toBe(a.value);
    expect(opts.env.CLAUDE_CONFIG_DIR).toBe("/tmp/u1");
    expect(opts.settingSources).toEqual([]);
  });

  it("serves a repeat ask from cache, but not one under another credential", async () => {
    claude.supportedModels.mockResolvedValue([]);
    const a = auth();
    await listModels({ agentAuth: a });
    await listModels({ agentAuth: a });
    expect(claude.supportedModels).toHaveBeenCalledTimes(1);
    await listModels({ agentAuth: auth() });
    expect(claude.supportedModels).toHaveBeenCalledTimes(2);
  });

  it("forgets a failure, so the next ask tries again", async () => {
    const a = auth();
    claude.supportedModels.mockRejectedValueOnce(new Error("boom"));
    await expect(listModels({ agentAuth: a })).rejects.toThrow("boom");
    claude.supportedModels.mockResolvedValue([]);
    await expect(listModels({ agentAuth: a })).resolves.toEqual([]);
  });

  it("gives up on a runtime that never answers", async () => {
    vi.useFakeTimers();
    claude.supportedModels.mockReturnValue(new Promise(() => {}));
    const pending = listModels({ agentAuth: auth() });
    const verdict = expect(pending).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(31_000);
    await verdict;
  });
});
