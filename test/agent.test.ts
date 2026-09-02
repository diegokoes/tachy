import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classify,
  classifyCall,
  qualify,
  claudePermission,
  claudeEnv,
  copilotPermission,
  effectiveModel,
  explainFailure,
  READ_TOOLS,
  WRITE_TOOLS,
  CONDITIONAL_WRITES,
  type AgentConfig,
  type Decision,
} from "../packages/agent/src/index";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AsyncQueue } from "../packages/agent/src/queue";
import { TurnBase } from "../packages/agent/src/turn";
import type { PermissionRequest } from "@github/copilot-sdk";

describe("agent tool allowlist (security boundary)", () => {
  it("classifies read tools as auto-run", () => {
    for (const t of READ_TOOLS) expect(classify(qualify(t)).cls).toBe("read");
  });

  it("classifies write tools as approval-gated", () => {
    for (const t of WRITE_TOOLS) expect(classify(qualify(t)).cls).toBe("write");
  });

  /**
   * An MCP tool missing from both lists is not a loud failure: it stays callable
   * and silently raises an approval box on every call, forever. The lists are
   * hand-maintained, so hold them against what is actually registered.
   */
  it("classifies every registered MCP tool", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "packages", "mcp", "src", "index.ts"),
      "utf8",
    );
    const registered = [...src.matchAll(/^tool\(\n\s*"([a-z0-9_]+)"/gm)].map(
      (m) => m[1],
    );
    expect(registered.length).toBeGreaterThan(40);

    // A conditional write is classified too — by its flag rather than a list.
    const listed = new Set<string>([
      ...READ_TOOLS,
      ...WRITE_TOOLS,
      ...Object.keys(CONDITIONAL_WRITES),
    ]);
    const unlisted = registered.filter((t) => !listed.has(t));
    expect(unlisted).toEqual([]);
  });

  it("denies any non-tachy / built-in tool", () => {
    for (const t of ["Bash", "Read", "Write", "Edit", "WebFetch", "Task"])
      expect(classify(t).cls).toBe("denied");
  });

  it("treats an unknown tachy tool as a write (never silently runs it)", () => {
    expect(classify("mcp__tachy__some_new_tool").cls).toBe("write");
  });

  it("gates compact_work_item only when it is asked to post a note", () => {
    const t = qualify("compact_work_item");
    expect(classifyCall(t, { source: "fd", external_id: "1" }).cls).toBe(
      "read",
    );
    expect(classifyCall(t, { post_note: false }).cls).toBe("read");
    expect(classifyCall(t, {}).cls).toBe("read");
    expect(classifyCall(t, { post_note: true }).cls).toBe("write");
    // a truthy non-true value must not open the write path
    expect(classifyCall(t, { post_note: "yes" }).cls).toBe("read");
  });

  it("classifyCall leaves every other tool's class alone", () => {
    for (const t of READ_TOOLS)
      expect(classifyCall(qualify(t), { post_note: true }).cls).toBe("read");
    for (const t of WRITE_TOOLS)
      expect(classifyCall(qualify(t), {}).cls).toBe("write");
    expect(classifyCall("Bash", { post_note: true }).cls).toBe("denied");
  });

  it("read and write sets are disjoint", () => {
    const reads = new Set<string>(READ_TOOLS);
    expect(WRITE_TOOLS.some((w) => reads.has(w))).toBe(false);
  });
});

describe("effectiveModel (allowlist clamp)", () => {
  it("passes the model through when no allowlist is set", () => {
    expect(effectiveModel({ model: "claude-sonnet-5" })).toBe(
      "claude-sonnet-5",
    );
    expect(effectiveModel({ model: "x", allowedModels: [] })).toBe("x");
    expect(effectiveModel({})).toBeUndefined();
  });

  it("keeps an allowed model and clamps a disallowed one", () => {
    const allowedModels = ["claude-sonnet-5", "claude-haiku-4-5"];
    expect(effectiveModel({ model: "claude-haiku-4-5", allowedModels })).toBe(
      "claude-haiku-4-5",
    );
    expect(effectiveModel({ model: "claude-opus-4-8", allowedModels })).toBe(
      "claude-sonnet-5",
    );
    expect(effectiveModel({ allowedModels })).toBe("claude-sonnet-5");
  });
});

const gateWith = (decision: Decision) => {
  const gate = vi.fn(async () => decision);
  return gate;
};

describe("claudePermission (approval gate)", () => {
  it("allows read tools without consulting the gate", async () => {
    const gate = gateWith({ approve: true });
    const res = await claudePermission(
      qualify("search_knowledge"),
      { q: "x" },
      "id1",
      gate,
    );
    expect(res).toMatchObject({ behavior: "allow" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("denies non-tachy tools without consulting the gate", async () => {
    const gate = gateWith({ approve: true });
    const res = await claudePermission("Bash", {}, "id2", gate);
    expect(res).toMatchObject({ behavior: "deny" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("gates write tools and applies the user's edited input on approve", async () => {
    const gate = gateWith({
      approve: true,
      updatedInput: { issue_summary: "edited" },
    });
    const res = await claudePermission(
      qualify("save_knowledge_entry"),
      { issue_summary: "orig" },
      "id3",
      gate,
    );
    expect(res).toEqual({
      behavior: "allow",
      updatedInput: { issue_summary: "edited" },
    });
    expect(gate).toHaveBeenCalledOnce();
  });

  it("skips the gate for a write the typed command authorised", async () => {
    const gate = gateWith({ approve: true });
    const res = await claudePermission(
      qualify("compact_work_item"),
      { post_note: true },
      "id5",
      gate,
      ["compact_work_item"],
    );
    expect(res).toMatchObject({ behavior: "allow" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("auto-approval covers only the named tool", async () => {
    const gate = gateWith({ approve: true });
    await claudePermission(qualify("save_knowledge_entry"), {}, "id6", gate, [
      "compact_work_item",
    ]);
    expect(gate).toHaveBeenCalledOnce();
  });

  it("denies write tools with the user's message on reject", async () => {
    const gate = gateWith({ approve: false, message: "wrong customer" });
    const res = await claudePermission(
      qualify("save_knowledge_entry"),
      {},
      "id4",
      gate,
    );
    expect(res).toEqual({ behavior: "deny", message: "wrong customer" });
  });
});

const mcpRequest = (
  toolName: string,
  overrides: Partial<Extract<PermissionRequest, { kind: "mcp" }>> = {},
): PermissionRequest =>
  ({
    kind: "mcp",
    serverName: "tachy",
    toolName,
    toolTitle: toolName,
    readOnly: false,
    toolCallId: "call1",
    args: { a: 1 },
    ...overrides,
  }) as PermissionRequest;

describe("copilotPermission (approval gate)", () => {
  it("rejects non-mcp and foreign-server requests without the gate", async () => {
    const gate = gateWith({ approve: true });
    expect(
      await copilotPermission(
        { kind: "shell", command: "rm -rf" } as unknown as PermissionRequest,
        gate,
      ),
    ).toMatchObject({ kind: "reject" });
    expect(
      await copilotPermission(
        mcpRequest("save_knowledge_entry", { serverName: "other" }),
        gate,
      ),
    ).toMatchObject({ kind: "reject" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("approves read tools without the gate", async () => {
    const gate = gateWith({ approve: true });
    expect(
      await copilotPermission(mcpRequest("search_knowledge"), gate),
    ).toEqual({ kind: "approve-once" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("gates write tools: approve-once on plain approval", async () => {
    const gate = gateWith({ approve: true });
    expect(
      await copilotPermission(mcpRequest("save_knowledge_entry"), gate),
    ).toEqual({ kind: "approve-once" });
    expect(gate).toHaveBeenCalledWith(
      "call1",
      qualify("save_knowledge_entry"),
      { a: 1 },
    );
  });

  it("rejects with feedback on denial", async () => {
    const gate = gateWith({ approve: false, message: "not now" });
    expect(
      await copilotPermission(mcpRequest("save_knowledge_entry"), gate),
    ).toEqual({ kind: "reject", feedback: "not now" });
  });

  it("relays edited input as a retry instruction (no input rewrite in Copilot)", async () => {
    const gate = gateWith({ approve: true, updatedInput: { a: 2 } });
    const res = await copilotPermission(
      mcpRequest("save_knowledge_entry"),
      gate,
    );
    expect(res.kind).toBe("reject");
    expect((res as { feedback: string }).feedback).toContain('{"a":2}');
  });
});

describe("AsyncQueue", () => {
  it("delivers pushed items in order then ends on close", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();
    const got: number[] = [];
    for await (const n of q.iterator()) got.push(n);
    expect(got).toEqual([1, 2]);
  });

  it("resolves a waiting consumer when an item arrives later", async () => {
    const q = new AsyncQueue<string>();
    const it = q.iterator();
    const next = it.next();
    q.push("hi");
    expect((await next).value).toBe("hi");
    q.close();
  });
});

describe("TurnBase approval lifecycle", () => {
  class FakeTurn extends TurnBase {
    aborted = false;
    ask(id: string) {
      return this.requestApproval(id, "save_knowledge_entry", {});
    }
    end() {
      this.finish();
    }
    protected onAbort(): void {
      this.aborted = true;
    }
  }

  it("resolves a pending approval through approve()", async () => {
    const t = new FakeTurn();
    const pending = t.ask("a1");
    t.approve("a1", { approve: true, updatedInput: { x: 1 } });
    expect(await pending).toEqual({ approve: true, updatedInput: { x: 1 } });
    expect(t.finished).toBe(false);
    t.end();
    expect(t.finished).toBe(true);
  });

  it("auto-denies an approval after the timeout", async () => {
    vi.useFakeTimers();
    try {
      process.env.TACHY_APPROVAL_TIMEOUT_MS = "1000";
      const t = new FakeTurn();
      const pending = t.ask("a2");
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toEqual({
        approve: false,
        message: "Approval timed out.",
      });
    } finally {
      delete process.env.TACHY_APPROVAL_TIMEOUT_MS;
      vi.useRealTimers();
    }
  });

  it("denies pending approvals and signals onAbort on abort()", async () => {
    const t = new FakeTurn();
    const pending = t.ask("a3");
    t.abort();
    expect(t.aborted).toBe(true);
    expect((await pending).approve).toBe(false);
  });
});

describe("claude subprocess environment (per-user credential isolation)", () => {
  const base: AgentConfig = {
    provider: "claude",
    mcpCommand: "node",
    mcpArgs: [],
    mcpEnv: {},
    cwd: "/tmp",
    systemPromptAppend: "",
  };

  const HOST_VARS = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_PROFILE",
    "CLAUDE_CODE_USE_BEDROCK",
  ];
  const saved = new Map<string, string | undefined>();
  const setHost = (k: string, v: string) => {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    process.env[k] = v;
  };

  afterEach(() => {
    for (const [k, v] of saved)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    saved.clear();
  });

  it("sends a subscription token as CLAUDE_CODE_OAUTH_TOKEN", () => {
    const env = claudeEnv({
      ...base,
      agentAuth: { kind: "anthropic_oauth", value: "oat-abc" },
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oat-abc");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("sends an API key as ANTHROPIC_API_KEY", () => {
    const env = claudeEnv({
      ...base,
      agentAuth: { kind: "anthropic_api_key", value: "sk-ant-api03-x" },
    });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-api03-x");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  // The regression that matters: Claude Code ranks every one of these above
  // CLAUDE_CODE_OAUTH_TOKEN, so a leftover host credential would silently
  // answer the turn on the wrong account.
  it("strips host credentials that would outrank the caller's own", () => {
    for (const k of HOST_VARS) setHost(k, "host-value");
    const env = claudeEnv({
      ...base,
      agentAuth: { kind: "anthropic_oauth", value: "oat-abc" },
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oat-abc");
    for (const k of HOST_VARS.filter((k) => k !== "CLAUDE_CODE_OAUTH_TOKEN"))
      expect(env[k]).toBeUndefined();
  });

  it("strips host credentials even when the caller has none", () => {
    setHost("ANTHROPIC_API_KEY", "host-key");
    const env = claudeEnv(base);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("keeps inherited non-credential vars such as PATH", () => {
    expect(claudeEnv(base).PATH).toBe(process.env.PATH);
  });

  it("isolates config dir and auto memory", () => {
    const env = claudeEnv({ ...base, configDir: "/state/users/u1" });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/state/users/u1");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });
});

describe("failure explanations", () => {
  it("reads a session limit as retryable, with its reset time", () => {
    const out = explainFailure(
      "Claude Code returned an error result: You've hit your session limit · resets 12:20am (Europe/Madrid)",
    );
    expect(out.kind).toBe("rate_limit");
    expect(out.message).toContain("12:20am");
  });

  it("points a missing credential at settings", () => {
    const out = explainFailure("Not logged in · Please run /login");
    expect(out.kind).toBe("no_credential");
    expect(out.message).toMatch(/Settings/);
  });

  it("distinguishes a rejected credential from a missing one", () => {
    const out = explainFailure("Invalid API key · Fix external API key");
    expect(out.kind).toBe("bad_credential");
  });

  it("passes anything else through unchanged", () => {
    expect(explainFailure("ECONNRESET")).toEqual({
      kind: "other",
      message: "ECONNRESET",
    });
  });
});
