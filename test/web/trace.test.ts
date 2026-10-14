import { describe, expect, it } from "vitest";
import {
  modelMismatch,
  ranOn,
  recordFrame,
  redactedCount,
  resultText,
  type TurnTrace,
} from "../../packages/web/src/chat/trace";

const traceOf = (model?: string): TurnTrace => ({
  sent: {
    systemPrompt: "",
    prompt: "hi",
    model,
    resumed: false,
    autoApprove: [],
    redactionForced: false,
  },
  calls: [],
});

const SESSION = {
  model: "claude-haiku-5-5",
  tools: [],
  mcpServers: [],
  credentialSource: "none",
  skills: [],
  plugins: [],
};

describe("recordFrame", () => {
  it("pairs a result with the call that asked for it", () => {
    const trace = traceOf();
    recordFrame(trace, "tool_use", {
      id: "a",
      tool: "mcp__tachy__fetch_work_item",
      input: { id: 7 },
    });
    recordFrame(trace, "tool_use", { id: "b", tool: "search_code" });
    recordFrame(trace, "tool_result", { id: "a", result: "ticket" });
    expect(trace.calls).toEqual([
      { id: "a", tool: "fetch_work_item", input: { id: 7 }, result: "ticket" },
      { id: "b", tool: "search_code", input: undefined },
    ]);
  });

  it("keeps a result whose call was never announced", () => {
    const trace = traceOf();
    recordFrame(trace, "tool_result", {
      id: "t",
      tool: "ToolSearch",
      result: "found",
    });
    expect(trace.calls).toEqual([
      { id: "t", tool: "ToolSearch", result: "found" },
    ]);
  });

  it("takes the session and the answering models, and passes on the rest", () => {
    const trace = traceOf();
    recordFrame(trace, "session", SESSION);
    recordFrame(trace, "result", { models: ["claude-haiku-5-5"] });
    recordFrame(trace, "text", { text: "hello" });
    expect(trace.session).toEqual(SESSION);
    expect(trace.answeredBy).toEqual(["claude-haiku-5-5"]);
    expect(trace.calls).toEqual([]);
  });
});

describe("resultText", () => {
  it("lays JSON out and leaves other text as it came", () => {
    expect(resultText([{ type: "text", text: '{"a":1}' }])).toBe(
      '{\n  "a": 1\n}',
    );
    expect(resultText("not json")).toBe("not json");
  });

  it("marks a picture as sent and joins the blocks", () => {
    expect(
      resultText([{ type: "text", text: "see" }, { type: "image" }, null]),
    ).toBe("see\n\n[image sent]\n\nnull");
  });

  it("shows any other shape as JSON, and nothing for no result", () => {
    expect(resultText({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(resultText(undefined)).toBe("");
  });
});

describe("redactedCount", () => {
  it("counts each replaced value once", () => {
    expect(
      redactedCount("[EMAIL_1] wrote to [EMAIL_2], cc [EMAIL_1] at [CUSTOMER]"),
    ).toBe(3);
  });

  it("is zero for text with no stand-in, bracketed or not", () => {
    expect(redactedCount("see [1] and [note]")).toBe(0);
  });
});

describe("modelMismatch", () => {
  const answered = (asked: string | undefined, by: string[]) => ({
    ...traceOf(asked),
    answeredBy: by,
  });

  it("is null when the model asked for answered", () => {
    expect(
      modelMismatch(answered("haiku", ["claude-haiku-5-5-20261001"])),
    ).toBeNull();
    expect(modelMismatch(answered("opus[1m]", ["claude-opus-5-5"]))).toBeNull();
  });

  it("is null with nothing to compare", () => {
    expect(modelMismatch(traceOf("haiku"))).toBeNull();
    expect(modelMismatch(answered(undefined, ["claude-opus-5-5"]))).toBeNull();
  });

  it("names both sides when another model answered", () => {
    expect(
      modelMismatch(answered("claude-haiku-5-5", ["claude-sonnet-5-5"])),
    ).toBe("asked claude-haiku-5-5, answered by claude-sonnet-5-5");
  });
});

describe("ranOn", () => {
  it("prefers what answered, then what started, then what was asked", () => {
    const trace = traceOf("haiku");
    expect(ranOn(traceOf())).toBe("settings default");
    expect(ranOn(trace)).toBe("haiku");
    trace.session = SESSION;
    expect(ranOn(trace)).toBe("claude-haiku-5-5");
    trace.answeredBy = ["claude-haiku-5-5-20261001"];
    expect(ranOn(trace)).toBe("claude-haiku-5-5-20261001");
  });
});
