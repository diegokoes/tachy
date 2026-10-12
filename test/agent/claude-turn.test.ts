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
