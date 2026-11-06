/** MCP over a sandbox's streams, against a tools server on the far side of them. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { SandboxProcess } from "@tachy/sandbox";
import { SandboxTransport } from "../../packages/agent/src/sandbox-transport";

/** What the launcher's client gives: stdin, stdout, `exit` once, and `kill`. */
class StandInSandbox extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  exited = false;
  killed = false;

  constructor(options: { exitsOnStdinEnd: boolean }) {
    super();
    if (options.exitsOnStdinEnd) this.stdin.on("end", () => this.exit(0));
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null);
    return true;
  }

  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    this.stdout.end();
    this.emit("exit", code);
  }
}

async function connected(options = { exitsOnStdinEnd: true }) {
  const sandbox = new StandInSandbox(options);
  const tools = new McpServer({ name: "tachy", version: "1" });
  tools.registerTool(
    "echo",
    { inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  await tools.connect(new StdioServerTransport(sandbox.stdin, sandbox.stdout));
  const transport = new SandboxTransport(sandbox as unknown as SandboxProcess);
  const errors: Error[] = [];
  const client = new Client({ name: "tachy-turn", version: "1" });
  client.onerror = (error) => errors.push(error);
  await client.connect(transport);
  return { sandbox, client, transport, errors };
}

describe("MCP over a sandbox", () => {
  it("carries a session through the sandbox's stdin and stdout", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
    const long = "x".repeat(256 * 1024);
    expect(
      await client.callTool({ name: "echo", arguments: { text: long } }),
    ).toMatchObject({ content: [{ type: "text", text: long }] });
    await client.close();
  });

  it("reports a malformed line and reads on", async () => {
    const { sandbox, client, errors } = await connected();
    sandbox.stdout.write("not json\n");
    expect(
      await client.callTool({ name: "echo", arguments: { text: "still" } }),
    ).toMatchObject({ content: [{ type: "text", text: "still" }] });
    expect(errors).toHaveLength(1);
    await client.close();
  });

  it("removes a sandbox whose output overflows the reader", async () => {
    const { sandbox, errors } = await connected();
    sandbox.stdout.write(Buffer.alloc(10 * 1024 * 1024 + 1, "x"));
    await new Promise((settled) => setImmediate(settled));
    expect(sandbox.killed).toBe(true);
    expect(errors[0]?.message).toMatch(/maximum size/);
  });

  it("lets a sandbox that exits by itself go, and removes one that does not", async () => {
    const leaving = await connected();
    await leaving.client.close();
    expect(leaving.sandbox.killed).toBe(false);

    const staying = await connected({ exitsOnStdinEnd: false });
    await staying.client.close();
    expect(staying.sandbox.killed).toBe(true);
    await staying.transport.close();
  });
});
