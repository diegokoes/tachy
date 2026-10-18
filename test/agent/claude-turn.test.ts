import { describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentEvent } from "../../packages/agent/src/index";

type Script = (signal: AbortSignal) => AsyncGenerator<unknown>;

const claude = vi.hoisted(() => ({ script: undefined as Script | undefined }));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: ({ options }: { options: { abortController: AbortController } }) =>
    claude.script!(options.abortController.signal),
}));

const { ClaudeTurn } = await import("../../packages/agent/src/claude");

const CONFIG: AgentConfig = {
  mcpCommand: "node",
  mcpArgs: [],
  mcpEnv: {},
  cwd: process.cwd(),
  systemPrompt: "",
};

const ANSWER = {
  type: "assistant",
  session_id: "session-1",
  message: { content: [{ type: "text", text: "so far" }] },
};
const RESULT = {
  type: "result",
  session_id: "session-1",
  result: "done",
  total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 2 },
};

/** Yields `messages`, then holds the turn open until it is aborted, and throws. */
const heldOpenAfter = (messages: unknown[]): Script =>
  async function* (signal) {
    yield* messages;
    if (!signal.aborted)
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
    throw new Error("the process was aborted");
  };

/** Runs a turn on `script`, aborting it once `abortAfter` events have arrived. */
async function eventsOf(script: Script, abortAfter?: number) {
  claude.script = script;
  const turn = new ClaudeTurn("hi", CONFIG);
  if (abortAfter === 0) turn.abort();
  const events: AgentEvent[] = [];
  for await (const event of turn.events()) {
    events.push(event);
    if (events.length === abortAfter) turn.abort();
  }
  return events;
}

describe("a stopped Claude turn", () => {
  it("says it was stopped, with no session, before any answer", async () => {
    expect(await eventsOf(heldOpenAfter([]), 0)).toEqual([{ type: "stopped" }]);
  });

  it("names the session a follow-up resumes once an answer has arrived", async () => {
    expect(await eventsOf(heldOpenAfter([ANSWER]), 1)).toEqual([
      { type: "text", text: "so far" },
      { type: "stopped", sessionId: "session-1" },
    ]);
  });

  it("is not reported for a turn that already has its result", async () => {
    const events = await eventsOf(heldOpenAfter([ANSWER, RESULT]), 2);
    expect(events.map((e) => e.type)).toEqual(["text", "result"]);
  });

  it("leaves a failure that was no stop as an error", async () => {
    const events = await eventsOf(async function* () {
      yield ANSWER;
      throw new Error("the model is on fire");
    });
    expect(events).toEqual([
      { type: "text", text: "so far" },
      { type: "error", kind: "other", message: "the model is on fire" },
    ]);
  });
});

describe("a Claude turn the CLI could not start", () => {
  it("shows the CLI's failure as one error, not as an answer", async () => {
    const events = await eventsOf(async function* () {
      yield {
        type: "assistant",
        session_id: "session-1",
        error: "authentication_failed",
        message: {
          content: [
            { type: "text", text: "Not logged in · Please run /login" },
          ],
        },
      };
      throw new Error("Claude Code process exited with code 1");
    });
    expect(events).toEqual([
      {
        type: "error",
        kind: "no_credential",
        message:
          "No Claude credential is set for your account. Add one under Settings › agent.",
      },
    ]);
  });

  it("names the failure kind when the CLI sent no text", async () => {
    const events = await eventsOf(async function* () {
      yield { ...ANSWER, error: "billing_error", message: { content: [] } };
    });
    expect(events).toEqual([
      { type: "error", kind: "other", message: "billing_error" },
    ]);
  });
});

describe("a Claude turn's own account of its model", () => {
  const INIT = {
    type: "system",
    subtype: "init",
    model: "claude-haiku-5-5",
    tools: ["ToolSearch"],
    mcp_servers: [{ name: "tachy", status: "connected", source: "sdk" }],
    apiKeySource: "ANTHROPIC_API_KEY",
    skills: [],
    plugins: [{ name: "none-loaded", path: "/nowhere" }],
  };
  const answerFrom = (model: string) => ({
    ...ANSWER,
    message: { ...ANSWER.message, model },
  });

  it("reports what the session started with", async () => {
    const [session] = await eventsOf(async function* () {
      yield INIT;
    });
    expect(session).toEqual({
      type: "session",
      model: "claude-haiku-5-5",
      tools: ["ToolSearch"],
      mcpServers: [{ name: "tachy", status: "connected" }],
      credentialSource: "ANTHROPIC_API_KEY",
      skills: [],
      plugins: ["none-loaded"],
    });
  });

  it("lists each model that answered once, in order of first use", async () => {
    const events = await eventsOf(async function* () {
      yield answerFrom("claude-haiku-5-5");
      yield answerFrom("claude-sonnet-5-5");
      yield answerFrom("claude-haiku-5-5");
      yield RESULT;
    });
    expect(events.at(-1)).toMatchObject({
      type: "result",
      models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
    });
  });
});
