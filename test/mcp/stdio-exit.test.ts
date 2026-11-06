/** The tools server as the api starts it: it leaves by itself once its stdin closes. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

/** The grace the api gives a closed tools process before it stops it. */
const CLOSE_GRACE_MS = 2_000;
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

describe("the tools server", () => {
  it("exits by itself, inside the api's grace, once its stdin closes", async () => {
    const server = spawn(
      process.execPath,
      ["--import", "tsx", "packages/mcp/src/index.ts"],
      { env: process.env, stdio: ["pipe", "pipe", "ignore"] },
    );
    const exited = once(server, "exit");
    const initialized = new Promise<void>((resolve) =>
      server.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes('"id":1')) resolve();
      }),
    );
    server.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    await initialized;
    const closedAt = Date.now();
    server.stdin.end();
    expect(await exited).toEqual([0, null]);
    expect(Date.now() - closedAt).toBeLessThan(CLOSE_GRACE_MS);
  });
});
