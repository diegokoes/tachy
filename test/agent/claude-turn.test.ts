import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig, AgentEvent } from "../../packages/agent/src/index";

type Script = (
  signal: AbortSignal,
  options: { canUseTool: CanUseTool },
) => AsyncGenerator<unknown>;

const claude = vi.hoisted(() => ({ script: undefined as Script | undefined }));
const toolsProcess = vi.hoisted(() => ({
  start: undefined as (() => Promise<unknown>) | undefined,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: ({
    options,
  }: {
    options: { abortController: AbortController; canUseTool: CanUseTool };
  }) => claude.script!(options.abortController.signal, options),
}));

vi.mock("../../packages/agent/src/turn-tools", () => ({
  startTurnTools: () => toolsProcess.start!(),
}));

const RUNNING_TOOLS = {
  serverConfig: { type: "sdk", name: "tachy", instance: {} },
  allow: () => {},
  inputProblem: (_tool: string, input: unknown) =>
    typeof (input as { body?: unknown }).body === "string"
      ? null
      : "body must be string",
  close: async () => {},
};

beforeEach(() => {
  toolsProcess.start = async () => RUNNING_TOOLS;
});

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

describe("a Claude turn whose tools did not start", () => {
  it("ends with that error and never starts Claude Code", async () => {
    const failure =
      "tachy's tools did not start for this turn; the server log has the reason";
    toolsProcess.start = async () => {
      throw new Error(failure);
    };
    let claudeStarted = false;
    const events = await eventsOf(async function* () {
      claudeStarted = true;
    });
    expect(events).toEqual([
      { type: "error", kind: "other", message: failure },
    ]);
    expect(claudeStarted).toBe(false);
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
          "no Claude credential is set for your account. add one under settings › agent",
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

describe("a Claude turn's tool results", () => {
  const CALL = {
    type: "assistant",
    session_id: "session-1",
    message: {
      content: [
        {
          type: "tool_use",
          id: "use-1",
          name: "mcp__tachy__search_knowledge",
          input: {},
        },
        {
          type: "tool_use",
          id: "use-2",
          name: "mcp__tachy__search_knowledge",
          input: {},
        },
      ],
    },
  };
  const resultOf = (id: string, extra: object) => ({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, ...extra }],
    },
  });

  it("says which failed", async () => {
    const events = await eventsOf(async function* () {
      yield CALL;
      yield resultOf("use-1", { content: "refused", is_error: true });
      yield resultOf("use-2", { content: "hits" });
      yield RESULT;
    });
    const results = events.filter((event) => event.type === "tool_result");
    expect(results).toEqual([
      {
        type: "tool_result",
        tool: "search_knowledge",
        id: "use-1",
        result: "refused",
        isError: true,
      },
      {
        type: "tool_result",
        tool: "search_knowledge",
        id: "use-2",
        result: "hits",
      },
    ]);
  });
});

describe("a Claude turn's approvals", () => {
  it("refuses an edit its tool's schema does not take, and keeps waiting", async () => {
    let decided: unknown;
    claude.script = async function* (signal, options) {
      decided = await options.canUseTool(
        "mcp__tachy__post_private_note",
        { body: "draft" },
        { signal, toolUseID: "use-1" } as never,
      );
      yield RESULT;
    };
    const turn = new ClaudeTurn("hi", CONFIG);
    for await (const event of turn.events()) {
      if (event.type !== "approval_request") continue;
      expect(() =>
        turn.approve("use-1", { approve: true, updatedInput: { body: 1 } }),
      ).toThrow("the edited input does not fit: body must be string");
      expect(turn.pendingApprovals).toBe(1);
      turn.approve("use-1", { approve: true, updatedInput: { body: "ok" } });
    }
    expect(decided).toEqual({
      behavior: "allow",
      updatedInput: { body: "ok" },
    });
  });
});

describe("a Claude turn's refused calls", () => {
  it("are logged under the id its tools log under", async () => {
    const lines: Record<string, unknown>[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        lines.push(JSON.parse(String(chunk)));
        return true;
      });
    claude.script = async function* (signal, options) {
      await options.canUseTool(
        "mcp__tachy__post_private_note",
        { body: ["x"] },
        { signal, toolUseID: "use-1" } as never,
      );
      yield RESULT;
    };
    try {
      const turn = new ClaudeTurn("hi", {
        ...CONFIG,
        mcpEnv: { TACHY_TURN_ID: "turn-7" },
      });
      for await (const _event of turn.events());
    } finally {
      spy.mockRestore();
    }
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "tool_input_refused",
        turn: "turn-7",
        tool: "post_private_note",
        reason: "body must be string",
      }),
    );
  });
});

describe("a Claude turn's usage", () => {
  it("reports the turn's cache reads and writes apart from its input", async () => {
    const events = await eventsOf(async function* () {
      yield ANSWER;
      yield {
        ...RESULT,
        total_cost_usd: 0.017,
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 2000,
        },
      };
    });
    expect(events.at(-1)).toMatchObject({
      type: "result",
      costUsd: 0.017,
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 5000,
        cacheWriteTokens: 2000,
      },
    });
  });
});
