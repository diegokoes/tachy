import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classify,
  classifyCall,
  qualify,
  claudePermission,
  claudeEnv,
  claudeOptions,
  effectiveModel,
  explainFailure,
  userStateDir,
  READ_TOOLS,
  WRITE_TOOLS,
  CONDITIONAL_WRITES,
  type AgentConfig,
  type Decision,
} from "../../packages/agent/src/index";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AsyncQueue } from "../../packages/agent/src/queue";
import { TurnBase } from "../../packages/agent/src/turn";

describe("agent tool allowlist (security boundary)", () => {
  it("classifies read tools as auto-run", () => {
    for (const tool of READ_TOOLS)
      expect(classify(qualify(tool)).cls).toBe("read");
  });

  it("classifies write tools as approval-gated", () => {
    for (const tool of WRITE_TOOLS)
      expect(classify(qualify(tool)).cls).toBe("write");
  });

  // An MCP tool missing from both lists stays callable and raises an approval
  // box on every call. The lists are hand-maintained, so they are held against
  // what is registered.
  it("classifies every registered MCP tool", () => {
    // Every .ts under packages/mcp/src, not one file: tools live one module per
    // domain, and a new module has to be caught without anyone remembering to
    // add it here.
    const here = dirname(fileURLToPath(import.meta.url));
    const root = join(here, "..", "..", "packages", "mcp", "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return walk(join(dir, entry.name));
        return entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [];
      });
    const registered = walk(root).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/^tool\(\n\s*"([a-z0-9_]+)"/gm)].map(
        (m) => m[1],
      ),
    );
    expect(registered.length).toBeGreaterThan(40);
    // No tool registered twice under two names.
    expect(new Set(registered).size).toBe(registered.length);

    // A conditional write is classified too - by its flag rather than a list.
    const listed = new Set<string>([
      ...READ_TOOLS,
      ...WRITE_TOOLS,
      ...Object.keys(CONDITIONAL_WRITES),
    ]);
    const unlisted = registered.filter((t) => !listed.has(t));
    expect(unlisted).toEqual([]);
  });

  // The prompt and the slash commands name tools by hand, so a rename on the
  // MCP side leaves the model told to call a tool that is not there. Input
  // fields share the verbs (`post_note`) and are told apart as schema keys.
  it("names only registered tools in the prompt and the slash commands", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const mcp = join(here, "..", "..", "packages", "mcp", "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return walk(join(dir, entry.name));
        return entry.name.endsWith(".ts")
          ? [readFileSync(join(dir, entry.name), "utf8")]
          : [];
      });
    const sources = walk(mcp);
    const registered = new Set(
      sources.flatMap((s) =>
        [...s.matchAll(/^tool\(\n\s*"([a-z0-9_]+)"/gm)].map((m) => m[1]),
      ),
    );
    const fields = new Set(
      sources.flatMap((s) =>
        [...s.matchAll(/^\s+([a-z0-9_]+): z\./gm)].map((m) => m[1]),
      ),
    );
    const text = ["packages/agent/prompt.md", "packages/api/src/commands.ts"]
      .map((f) => readFileSync(join(here, "..", "..", f), "utf8"))
      .join("\n");
    const verbs =
      /\b(?:list|get|add|set|save|update|search|fetch|create|post|compact|ingest|export|read|draft|record)_[a-z0-9_]+\b/g;
    const named = new Set(text.match(verbs));
    const missing = [...named].filter(
      (t) => !registered.has(t) && !fields.has(t),
    );
    expect(named.size).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("denies any non-tachy / built-in tool", () => {
    for (const tool of ["Bash", "Read", "Write", "Edit", "WebFetch", "Task"])
      expect(classify(tool).cls).toBe("denied");
  });

  it("treats an unknown tachy tool as a write (never silently runs it)", () => {
    expect(classify("mcp__tachy__some_new_tool").cls).toBe("write");
  });

  it("gates compact_work_item unless it is told not to post", () => {
    const tool = qualify("compact_work_item");
    // The tool posts on `post_note !== false`, so an omitted flag is a write.
    expect(classifyCall(tool, { source: "fd", external_id: "1" }).cls).toBe(
      "write",
    );
    expect(classifyCall(tool, {}).cls).toBe("write");
    expect(classifyCall(tool, { post_note: true }).cls).toBe("write");
    expect(classifyCall(tool, { post_note: "yes" }).cls).toBe("write");
    expect(classifyCall(tool, { post_note: false }).cls).toBe("read");
  });

  it("gates ingest_context only when it is given a URL to fetch", () => {
    const tool = qualify("ingest_context");
    expect(classifyCall(tool, { text: "pasted" }).cls).toBe("read");
    expect(classifyCall(tool, { paths: ["/uploads/a.pdf"] }).cls).toBe("read");
    expect(classifyCall(tool, { urls: [] }).cls).toBe("read");
    expect(classifyCall(tool, { urls: ["https://example.com"] }).cls).toBe(
      "write",
    );
  });

  it("classifyCall leaves every other tool's class alone", () => {
    for (const tool of READ_TOOLS)
      expect(classifyCall(qualify(tool), { post_note: true }).cls).toBe("read");
    // compact_work_item and ingest_context are the only conditional ones.
    for (const tool of WRITE_TOOLS)
      expect(classifyCall(qualify(tool), {}).cls).toBe("write");
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
    const decision = await claudePermission(
      qualify("search_knowledge"),
      { q: "x" },
      "id1",
      gate,
    );
    expect(decision).toMatchObject({ behavior: "allow" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("denies non-tachy tools without consulting the gate", async () => {
    const gate = gateWith({ approve: true });
    const decision = await claudePermission("Bash", {}, "id2", gate);
    expect(decision).toMatchObject({ behavior: "deny" });
    expect(gate).not.toHaveBeenCalled();
  });

  it("gates write tools and applies the user's edited input on approve", async () => {
    const gate = gateWith({
      approve: true,
      updatedInput: { issue_summary: "edited" },
    });
    const decision = await claudePermission(
      qualify("save_knowledge_entry"),
      { issue_summary: "orig" },
      "id3",
      gate,
    );
    expect(decision).toEqual({
      behavior: "allow",
      updatedInput: { issue_summary: "edited" },
    });
    expect(gate).toHaveBeenCalledOnce();
  });

  it("skips the gate for a write the typed command authorised", async () => {
    const gate = gateWith({ approve: true });
    const decision = await claudePermission(
      qualify("compact_work_item"),
      { post_note: true },
      "id5",
      gate,
      ["compact_work_item"],
    );
    expect(decision).toMatchObject({ behavior: "allow" });
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
    const decision = await claudePermission(
      qualify("save_knowledge_entry"),
      {},
      "id4",
      gate,
    );
    expect(decision).toEqual({ behavior: "deny", message: "wrong customer" });
  });
});

describe("AsyncQueue", () => {
  it("delivers pushed items in order then ends on close", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();
    const got: number[] = [];
    for await (const n of queue.iterator()) got.push(n);
    expect(got).toEqual([1, 2]);
  });

  it("resolves a waiting consumer when an item arrives later", async () => {
    const queue = new AsyncQueue<string>();
    const iterator = queue.iterator();
    const next = iterator.next();
    queue.push("hi");
    expect((await next).value).toBe("hi");
    queue.close();
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
    const turn = new FakeTurn();
    const pending = turn.ask("a1");
    turn.approve("a1", { approve: true, updatedInput: { x: 1 } });
    expect(await pending).toEqual({ approve: true, updatedInput: { x: 1 } });
    expect(turn.finished).toBe(false);
    turn.end();
    expect(turn.finished).toBe(true);
  });

  it("auto-denies an approval after the timeout", async () => {
    vi.useFakeTimers();
    try {
      process.env.TACHY_APPROVAL_TIMEOUT_MS = "1000";
      const turn = new FakeTurn();
      const pending = turn.ask("a2");
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
    const turn = new FakeTurn();
    const pending = turn.ask("a3");
    turn.abort();
    expect(turn.aborted).toBe(true);
    expect((await pending).approve).toBe(false);
  });
});

describe("claude subprocess environment (per-user credential isolation)", () => {
  const base: AgentConfig = {
    mcpCommand: "node",
    mcpArgs: [],
    mcpEnv: {},
    cwd: "/tmp",
    systemPrompt: "",
  };

  const HOST_VARS = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_PROFILE",
    "CLAUDE_CODE_USE_BEDROCK",
  ];
  const saved = new Map<string, string | undefined>();
  const setHost = (name: string, value: string) => {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
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

  // Claude Code ranks every one of these above CLAUDE_CODE_OAUTH_TOKEN, so a
  // leftover host credential would answer the turn on the wrong account.
  it("strips host credentials that would outrank the caller's own", () => {
    for (const name of HOST_VARS) setHost(name, "host-value");
    const env = claudeEnv({
      ...base,
      agentAuth: { kind: "anthropic_oauth", value: "oat-abc" },
    });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oat-abc");
    for (const name of HOST_VARS.filter((k) => k !== "CLAUDE_CODE_OAUTH_TOKEN"))
      expect(env[name]).toBeUndefined();
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

  it("keeps the caller's claude.ai connectors out of the turn", () => {
    expect(claudeEnv(base).ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
  });
});

// What reaches the model besides the conversation. The SDK defaults to reading
// instructions, settings and servers from disk, and a file picked up that way
// is paid for on every turn without anyone having written it for the agent.
describe("what the agent reads", () => {
  const config: AgentConfig = {
    mcpCommand: "node",
    mcpArgs: ["packages/mcp/src/index.ts"],
    mcpEnv: {},
    cwd: "/app",
    systemPrompt: "the prompt",
  };

  it("gives Claude the prompt as its whole system prompt, and nothing from disk", () => {
    const options = claudeOptions(
      config,
      {},
      new AbortController(),
      async () => ({
        behavior: "deny",
        message: "",
      }),
    );
    expect(options.systemPrompt).toBe("the prompt");
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.title).toBeTruthy();
    expect(options.cwd).toBe("/app");
  });

  // With tool search on, the tachy tools are deferred behind ToolSearch; a
  // turn without it starts with no tools at all.
  it("keeps ToolSearch and no other Claude Code built-in", () => {
    const options = claudeOptions(
      config,
      {},
      new AbortController(),
      async () => ({
        behavior: "deny",
        message: "",
      }),
    );
    expect(options.tools).toEqual(["ToolSearch"]);
  });
});

describe("where a caller's agent state lives", () => {
  it("is one directory per user under the agent home", () => {
    const home = mkdtempSync(join(tmpdir(), "tachy-agent-"));
    process.env.TACHY_AGENT_HOME = home;
    try {
      expect(userStateDir("u1")).toBe(join(home, "users", "u1"));
      expect(userStateDir(null)).toBe(join(home, "users", "_default"));
    } finally {
      delete process.env.TACHY_AGENT_HOME;
    }
  });
});

describe("failure explanations", () => {
  it("reads a session limit as retryable, with its reset time", () => {
    const explained = explainFailure(
      "Claude Code returned an error result: You've hit your session limit · resets 12:20am (Europe/Madrid)",
    );
    expect(explained.kind).toBe("rate_limit");
    expect(explained.message).toContain("12:20am");
  });

  it("points a missing credential at settings", () => {
    const explained = explainFailure("Not logged in · Please run /login");
    expect(explained.kind).toBe("no_credential");
    expect(explained.message).toMatch(/Settings/);
  });

  it("distinguishes a rejected credential from a missing one", () => {
    const explained = explainFailure("Invalid API key · Fix external API key");
    expect(explained.kind).toBe("bad_credential");
  });

  it("passes anything else through unchanged", () => {
    expect(explainFailure("ECONNRESET")).toEqual({
      kind: "other",
      message: "ECONNRESET",
    });
  });
});
