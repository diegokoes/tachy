import { describe, expect, it, vi } from "vitest";
import {
  classify,
  qualify,
  claudePermission,
  copilotPermission,
  effectiveModel,
  READ_TOOLS,
  WRITE_TOOLS,
  type Decision,
} from "../packages/agent/src/index";
import { AsyncQueue } from "../packages/agent/src/queue";
import type { PermissionRequest } from "@github/copilot-sdk";

describe("agent tool allowlist (security boundary)", () => {
  it("classifies read tools as auto-run", () => {
    for (const t of READ_TOOLS) expect(classify(qualify(t)).cls).toBe("read");
  });

  it("classifies write tools as approval-gated", () => {
    for (const t of WRITE_TOOLS) expect(classify(qualify(t)).cls).toBe("write");
  });

  it("denies any non-tachy / built-in tool", () => {
    for (const t of ["Bash", "Read", "Write", "Edit", "WebFetch", "Task"])
      expect(classify(t).cls).toBe("denied");
  });

  it("treats an unknown tachy tool as a write (never silently runs it)", () => {
    expect(classify("mcp__tachy__some_new_tool").cls).toBe("write");
  });

  it("read and write sets are disjoint", () => {
    const reads = new Set<string>(READ_TOOLS);
    expect(WRITE_TOOLS.some((w) => reads.has(w))).toBe(false);
  });
});

describe("effectiveModel (allowlist clamp)", () => {
  it("passes the model through when no allowlist is set", () => {
    expect(effectiveModel({ model: "claude-sonnet-5" })).toBe("claude-sonnet-5");
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
    expect(await copilotPermission(mcpRequest("search_knowledge"), gate)).toEqual(
      { kind: "approve-once" },
    );
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
