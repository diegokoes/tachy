import { describe, expect, it } from "vitest";
import {
  classify,
  qualify,
  READ_TOOLS,
  WRITE_TOOLS,
} from "../packages/agent/src/index";
import { AsyncQueue } from "../packages/agent/src/queue";

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
