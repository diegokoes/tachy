/** A turn's tools against a real tools process: what they forward, and what they hold back. */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startTurnTools,
  type TurnTools,
} from "../../packages/agent/src/turn-tools";

const STUB_TOOLS = fileURLToPath(
  new URL("../fixtures/stub-tools.mjs", import.meta.url),
);
const NOTE = { source: "fd", external_id: "1", body: "note" };
const NOT_STARTED =
  "tachy's tools did not start for this turn; the server log has the reason";

describe("a turn's tools", () => {
  let tools: TurnTools;
  let claudeCode: Client;
  let toolsLog: string;

  const ran = () =>
    existsSync(toolsLog)
      ? readFileSync(toolsLog, "utf8").trim().split("\n")
      : [];
  const call = (name: string, args: Record<string, unknown>) =>
    claudeCode.callTool({ name, arguments: args });

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "tachy-turn-tools-"));
    toolsLog = join(dir, "tools.log");
    tools = await startTurnTools({
      command: process.execPath,
      args: [STUB_TOOLS],
      env: { STUB_TOOLS_LOG: toolsLog },
      cwd: dir,
    });
    const [claudeSide, toolsSide] = InMemoryTransport.createLinkedPair();
    await tools.server.connect(toolsSide);
    claudeCode = new Client({ name: "claude-code", version: "1" });
    await claudeCode.connect(claudeSide);
  });

  afterEach(async () => {
    await claudeCode.close();
    await tools.close();
  });

  it("lists what the tools process offers", async () => {
    const { tools: offered } = await claudeCode.listTools();
    expect(offered.map((tool) => tool.name).sort()).toEqual([
      "ingest_context",
      "post_private_note",
      "search_knowledge",
    ]);
  });

  it("passes a read through", async () => {
    expect(await call("search_knowledge", { query: "vpn" })).toMatchObject({
      content: [{ type: "text", text: "no hits" }],
    });
    expect(ran()).toEqual(["search_knowledge"]);
  });

  it("refuses a write nobody approved, and never forwards it", async () => {
    expect(await call("post_private_note", NOTE)).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "post_private_note was not approved" }],
    });
    expect(ran()).toEqual([]);
  });

  it("runs an approved write once", async () => {
    tools.allow("post_private_note", NOTE);
    expect((await call("post_private_note", NOTE)).isError).toBeFalsy();
    expect((await call("post_private_note", NOTE)).isError).toBe(true);
    expect(ran()).toEqual(["post_private_note note"]);
  });

  it("runs a write only with the input the person approved", async () => {
    const edited = { ...NOTE, body: "edited" };
    tools.allow("post_private_note", edited);
    expect((await call("post_private_note", NOTE)).isError).toBe(true);
    expect((await call("post_private_note", edited)).isError).toBeFalsy();
    expect(ran()).toEqual(["post_private_note edited"]);
  });

  it("says why an input does not fit the schema the tools listed", async () => {
    await claudeCode.listTools();
    expect(
      tools.inputProblem("post_private_note", { ...NOTE, body: ["x"] }),
    ).toBe("body must be string");
    expect(
      tools.inputProblem("post_private_note", { source: "fd", body: "x" }),
    ).toBe("input must have required property 'external_id'");
  });

  it("finds no problem in a fitting input, an extra key or a tool not listed", async () => {
    expect(tools.inputProblem("post_private_note", { body: 1 })).toBeNull();
    await claudeCode.listTools();
    expect(tools.inputProblem("post_private_note", NOTE)).toBeNull();
    expect(
      tools.inputProblem("post_private_note", { ...NOTE, extra: true }),
    ).toBeNull();
    expect(tools.inputProblem("no_such_tool", {})).toBeNull();
  });

  it("holds a URL fetch for approval, but not pasted text", async () => {
    const fetched = await call("ingest_context", {
      urls: ["https://example.com/page"],
    });
    const pasted = await call("ingest_context", { text: "notes" });
    expect(fetched.isError).toBe(true);
    expect(pasted.isError).toBeFalsy();
    expect(ran()).toEqual(["ingest_context text"]);
  });
});

describe("a turn's tools that do not start", () => {
  it("fail with a message that points at the server log", async () => {
    await expect(
      startTurnTools({
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
        env: {},
        cwd: tmpdir(),
      }),
    ).rejects.toThrow(NOT_STARTED);
  });
});

describe("a turn's tools in a sandbox", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fail the same way when the launcher cannot be reached", async () => {
    vi.stubEnv("TACHY_TURN_SANDBOX", "on");
    vi.stubEnv(
      "TACHY_SANDBOX_SOCKET",
      join(mkdtempSync(join(tmpdir(), "tachy-no-launcher-")), "launcher.sock"),
    );
    await expect(
      startTurnTools({
        command: process.execPath,
        args: [STUB_TOOLS],
        env: {},
        cwd: tmpdir(),
      }),
    ).rejects.toThrow(NOT_STARTED);
  });
});
