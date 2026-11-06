/** Claude Code's spawn through the sandbox launcher, against a stand-in launcher. */
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { claudeOptions } from "../../packages/agent/src/claude";
import {
  sandboxedSpawn,
  sandboxOption,
  stateNameOf,
} from "../../packages/agent/src/sandboxed-spawn";
import { userStateDir } from "../../packages/agent/src/state";
import {
  encodeFrame,
  exitFrame,
  FrameReader,
  parseSandboxRequest,
  STREAM,
  type SandboxRequest,
} from "../../packages/sandbox/src/protocol";

/** Echoes stdin back as stdout and exits 0 at its end, or refuses every request. */
function startStandInLauncher(
  socketPath: string,
  received: SandboxRequest[],
  refusal?: string,
): Promise<Server> {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    let head = Buffer.alloc(0);
    let request: SandboxRequest | undefined;
    const frames = new FrameReader();
    socket.on("data", (chunk: Buffer) => {
      let rest = chunk;
      if (!request) {
        head = Buffer.concat([head, chunk]);
        const newline = head.indexOf("\n");
        if (newline < 0) return;
        request = parseSandboxRequest(head.subarray(0, newline).toString());
        received.push(request);
        if (refusal)
          return void socket.end(exitFrame({ exitCode: null, error: refusal }));
        rest = head.subarray(newline + 1);
      }
      for (const frame of frames.read(rest))
        if (frame.stream === STREAM.stdin)
          socket.write(encodeFrame(STREAM.stdout, frame.payload));
        else if (frame.stream === STREAM.stdinEnd)
          socket.end(exitFrame({ exitCode: 0 }));
    });
  });
  return new Promise((listening) =>
    server.listen(socketPath, () => listening(server)),
  );
}

const spawnOptions = (signal = new AbortController().signal): SpawnOptions => ({
  command: "/host/node_modules/claude",
  args: ["--output-format", "stream-json"],
  cwd: "/app",
  env: { ANTHROPIC_API_KEY: "sk-test", UNSET_NAME: undefined },
  signal,
});

const exitOf = (child: ReturnType<ReturnType<typeof sandboxedSpawn>>) =>
  new Promise<unknown[]>((resolve) =>
    child.once("exit", (...args: unknown[]) => resolve(args)),
  );

afterEach(() => {
  delete process.env.TACHY_TURN_SANDBOX;
  delete process.env.TACHY_SANDBOX_SOCKET;
  delete process.env.TACHY_AGENT_HOME;
});

describe("Claude Code through the launcher", () => {
  const dir = mkdtempSync(join(tmpdir(), "tachy-spawn-"));
  const received: SandboxRequest[] = [];
  let echoing: Server;
  let refusing: Server;

  beforeAll(async () => {
    echoing = await startStandInLauncher(join(dir, "echo.sock"), received);
    refusing = await startStandInLauncher(
      join(dir, "refuse.sock"),
      received,
      "the sandbox limit is reached",
    );
  });

  afterAll(async () => {
    await new Promise((closed) => echoing.close(closed));
    await new Promise((closed) => refusing.close(closed));
  });

  it("asks for a claude sandbox with the SDK's args, its defined env and the person's state", async () => {
    process.env.TACHY_SANDBOX_SOCKET = join(dir, "echo.sock");
    received.length = 0;
    const child = sandboxedSpawn("users/_default")(spawnOptions());
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const exited = exitOf(child);
    child.stdin.end('{"type":"user"}\n');
    expect(await exited).toEqual([0, null]);
    expect(stdout).toBe('{"type":"user"}\n');
    expect(received).toEqual([
      {
        kind: "claude",
        args: ["--output-format", "stream-json"],
        env: { ANTHROPIC_API_KEY: "sk-test" },
        state: "users/_default",
      },
    ]);
  });

  it("kills the sandbox when the SDK aborts", async () => {
    process.env.TACHY_SANDBOX_SOCKET = join(dir, "echo.sock");
    const controller = new AbortController();
    const child = sandboxedSpawn()(spawnOptions(controller.signal));
    const exited = exitOf(child);
    controller.abort();
    expect(await exited).toEqual([null, "SIGKILL"]);
    expect(child.killed).toBe(true);
  });

  it("reports a launcher refusal as an error, then an exit", async () => {
    process.env.TACHY_SANDBOX_SOCKET = join(dir, "refuse.sock");
    const child = sandboxedSpawn()(spawnOptions());
    const failure = new Promise<Error>((resolve) =>
      child.once("error", resolve),
    );
    const exited = exitOf(child);
    expect((await failure).message).toBe("the sandbox limit is reached");
    expect(await exited).toEqual([null, "SIGKILL"]);
  });
});

describe("when Claude Code is sandboxed", () => {
  it("names a person's state folder as the launcher does", () => {
    process.env.TACHY_AGENT_HOME = "/home/node/.claude";
    expect(
      stateNameOf(userStateDir("0b6f7c3e-5d1a-4f2b-9e8c-7a6d5c4b3a21")),
    ).toBe("users/0b6f7c3e-5d1a-4f2b-9e8c-7a6d5c4b3a21");
    expect(stateNameOf(userStateDir(null))).toBe("users/_default");
  });

  it("only when TACHY_TURN_SANDBOX is on", () => {
    expect(sandboxOption()).toEqual({});
    process.env.TACHY_TURN_SANDBOX = "on";
    expect(sandboxOption().spawnClaudeCodeProcess).toBeTypeOf("function");
  });

  it("for a turn, with the person's state", () => {
    const optionsFor = () =>
      claudeOptions(
        {
          mcpCommand: "node",
          mcpArgs: [],
          mcpEnv: {},
          cwd: "/app",
          systemPrompt: "",
          configDir: userStateDir("u1"),
        },
        {
          abortController: new AbortController(),
          canUseTool: async () => ({ behavior: "deny", message: "" }),
          toolServer: {
            type: "sdk",
            name: "tachy",
            instance: new McpServer({ name: "tachy", version: "1" }),
          },
        },
      );
    expect(optionsFor().spawnClaudeCodeProcess).toBeUndefined();
    process.env.TACHY_TURN_SANDBOX = "on";
    expect(optionsFor().spawnClaudeCodeProcess).toBeTypeOf("function");
  });
});
