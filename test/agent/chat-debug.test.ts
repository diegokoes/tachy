import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "@tachy/core/access";
import { agentUsageCensus } from "@tachy/core/analytics";
import type { AgentConfig, AgentEvent, AgentTurn } from "@tachy/agent";
import { createApp } from "../../packages/api/src/app";
import { json, loginCookie } from "../http";
import { resetData, sql } from "../database";

const SESSION: AgentEvent = {
  type: "session",
  model: "claude-haiku-5-5",
  tools: ["ToolSearch"],
  mcpServers: [{ name: "tachy", status: "connected" }],
  credentialSource: "ANTHROPIC_API_KEY",
  skills: [],
  plugins: [],
};
type ResultEvent = Extract<AgentEvent, { type: "result" }>;
const RESULT: ResultEvent = {
  type: "result",
  result: "done",
  costUsd: 0,
  sessionId: "session-1",
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  },
  models: ["claude-haiku-5-5-20261001"],
};

/** A turn that reports its session, answers and ends. */
class ScriptedTurn implements AgentTurn {
  finished = false;
  pendingApprovals = 0;
  oldestPendingApprovalAt = null;
  approve() {}
  abort() {}
  async *events(): AsyncGenerator<AgentEvent> {
    yield SESSION;
    yield turnResult;
    this.finished = true;
  }
}

let turnResult: ResultEvent = RESULT;

const configs: AgentConfig[] = [];
vi.mock("@tachy/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tachy/agent")>()),
  startTurn: (_prompt: string, config: AgentConfig) => {
    configs.push(config);
    return new ScriptedTurn();
  },
}));

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });
const cookies: Record<string, string> = {};

/** Runs one chat turn to its end and returns every frame it sent. */
async function framesOf(who: string, body: Record<string, unknown>) {
  const response = await app.request("/api/agent/chat", {
    ...json({ message: "hi", ...body }),
    headers: { "Content-Type": "application/json", Cookie: cookies[who] },
  });
  expect(response.status).toBe(200);
  const frames: { event: string; data: any }[] = [];
  for (const raw of (await response.text()).split("\n\n")) {
    const event = /event: (.*)/.exec(raw)?.[1];
    const data = /data: (.*)/.exec(raw)?.[1];
    if (event) frames.push({ event, data: data ? JSON.parse(data) : null });
  }
  return frames;
}

beforeEach(async () => {
  await resetData();
  await sql`delete from settings where key = 'allowed_models'`;
  configs.length = 0;
  turnResult = RESULT;
  for (const [who, role] of [
    ["ada", "admin"],
    ["mel", "member"],
  ] as const) {
    await createUser({
      email: `${who}@example.com`,
      password: "a-long-password",
      role,
    });
    cookies[who] = await loginCookie(
      app,
      `${who}@example.com`,
      "a-long-password",
    );
  }
});

describe("chat debug", () => {
  it("sends an admin what the turn was started with, and nothing else of its config", async () => {
    const frames = await framesOf("ada", {
      debug: true,
      model: "claude-haiku-5-5",
      effort: "medium",
      mode: { name: "code", args: "" },
      command: { name: "az", args: "explain why is it slow" },
    });
    expect(frames.map((f) => f.event)).toEqual([
      "start",
      "debug",
      "session",
      "result",
    ]);

    const sent = frames[1].data;
    expect(Object.keys(sent).sort()).toEqual([
      "autoApprove",
      "effort",
      "linkedServers",
      "model",
      "prompt",
      "redactionForced",
      "resumed",
      "systemPrompt",
    ]);
    expect(sent).toMatchObject({
      model: "claude-haiku-5-5",
      effort: "medium",
      resumed: false,
      redactionForced: false,
      systemPrompt: configs[0].systemPrompt,
    });
    expect(sent.prompt).toContain('<mode name="code">');
    expect(sent.prompt).toContain('<command name="az">');
    expect(sent.prompt).toContain("why is it slow");
    expect(frames[2].data).toMatchObject({ model: "claude-haiku-5-5" });
  });

  it("says a turn is resumed when it continues a session", async () => {
    const frames = await framesOf("ada", { debug: true, sessionId: "s-1" });
    expect(frames[1].data.resumed).toBe(true);
  });

  it("ignores the flag from a member", async () => {
    const frames = await framesOf("mel", { debug: true });
    expect(frames.map((f) => f.event)).toEqual(["start", "result"]);
  });

  it("sends an admin no debug frames unasked", async () => {
    const frames = await framesOf("ada", {});
    expect(frames.map((f) => f.event)).toEqual(["start", "result"]);
  });

  it("records each resumed turn's own cost from the session's running total", async () => {
    for (const sessionTotalUsd of [0.0085, 0.017, 0.0255]) {
      turnResult = {
        ...RESULT,
        costUsd: sessionTotalUsd,
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 5000,
          cacheWriteTokens: 2000,
        },
      };
      await framesOf("mel", { sessionId: "session-1" });
    }
    const runs = await sql`
      select meta from analysis_runs where mode = 'chat' order by created_at
    `;
    expect(runs.map((r) => r.meta.session_cost_usd)).toEqual([
      0.0085, 0.017, 0.0255,
    ]);
    for (const run of runs) {
      expect(run.meta.cost_usd).toBeCloseTo(0.0085, 9);
      expect(run.meta).toMatchObject({
        cache_read_tokens: 5000,
        cache_write_tokens: 2000,
      });
    }
    const usage = await agentUsageCensus(30);
    expect(usage.cost_usd).toBeCloseTo(0.0255, 9);
    expect(usage.cached_tokens).toBe(21_000);
  });

  it("records the model that answered, not the one asked for", async () => {
    await framesOf("mel", { model: "claude-haiku-5-5" });
    const [run] =
      await sql`select model from analysis_runs where mode = 'chat'`;
    expect(run.model).toBe("claude-haiku-5-5-20261001");
  });
});
