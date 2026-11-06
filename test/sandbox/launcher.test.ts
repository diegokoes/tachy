/**
 * The launcher against the real Docker daemon. A stock image stands in for
 * Claude Code: what matters is what the container can and cannot do.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { SandboxProcess } from "../../packages/sandbox/src/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSandbox } from "../../packages/sandbox/src/client";
import {
  startLauncher,
  type Launcher,
  type LauncherSettings,
} from "../../packages/sandbox/src/launcher";

const IMAGE = "node:26.13.0-slim";
const RUN_ID = randomUUID().slice(0, 8);
const PERSON = randomUUID();
const POLL_MS = 100;
const POLL_LIMIT_MS = 20_000;

const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();

const settingsFor = (
  socketDir: string,
  maxSandboxes = 2,
): LauncherSettings => ({
  instance: `tachy-test-${RUN_ID}`,
  image: IMAGE,
  network: `tachy-test-sandbox-${RUN_ID}`,
  stateVolume: `tachy-test-state-${RUN_ID}`,
  proxyUrl: "http://egress.invalid:3128",
  memoryMb: 256,
  pidsLimit: 64,
  cpus: 1,
  socketPath: join(socketDir, "launcher.sock"),
  dockerSocket: "/var/run/docker.sock",
  maxSandboxes,
});

/** `exit`'s arguments. Unlike `events.once`, an `error` first does not reject it. */
const exitOf = (sandbox: SandboxProcess) =>
  new Promise<unknown[]>((resolve) =>
    sandbox.once("exit", (...args: unknown[]) => resolve(args)),
  );

function ensureImage(): void {
  try {
    docker("image", "inspect", IMAGE);
  } catch {
    docker("pull", IMAGE);
  }
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((wait) => setTimeout(wait, POLL_MS));
  }
}

describe("the sandbox launcher", () => {
  const settings = settingsFor(mkdtempSync(join(tmpdir(), "tachy-launcher-")));
  const ownContainers = () =>
    docker("ps", "-aq", "--filter", `label=tachy.sandbox=${settings.instance}`)
      .split("\n")
      .filter(Boolean);
  let launcher: Launcher;

  async function run(
    args: string[],
    options: {
      env?: Record<string, string>;
      state?: string;
      stdin?: string;
    } = {},
  ) {
    const sandbox = openSandbox(
      {
        kind: "claude",
        args,
        env: options.env ?? {},
        ...(options.state ? { state: options.state } : {}),
      },
      { socketPath: settings.socketPath },
    );
    let stdout = "";
    let error: string | undefined;
    sandbox.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    sandbox.on("error", (failure: Error) => (error = failure.message));
    const exited = exitOf(sandbox);
    const drained = once(sandbox.stdout, "end");
    sandbox.stdin.end(options.stdin ?? "");
    const [[exitCode]] = await Promise.all([exited, drained]);
    return { stdout, exitCode, error };
  }

  beforeAll(async () => {
    ensureImage();
    docker("network", "create", "--internal", settings.network);
    docker("volume", "create", settings.stateVolume);
    docker(
      "run",
      "--rm",
      "-v",
      `${settings.stateVolume}:/state`,
      IMAGE,
      "sh",
      "-c",
      `mkdir -p /state/users/${PERSON} && chown 1000:1000 /state/users/${PERSON}`,
    );
    launcher = await startLauncher(settings);
  }, 120_000);

  afterAll(async () => {
    await launcher.close();
    docker("network", "rm", settings.network);
    docker("volume", "rm", settings.stateVolume);
  });

  it("streams stdin to the container and its output back", async () => {
    expect(await run(["cat"], { stdin: "ping\n" })).toEqual({
      stdout: "ping\n",
      exitCode: 0,
      error: undefined,
    });
    expect((await run(["sh", "-c", "exit 3"])).exitCode).toBe(3);
  });

  it("runs as an unprivileged user on a read-only root", async () => {
    const { stdout } = await run([
      "sh",
      "-c",
      "grep -E '^(Uid|CapEff|NoNewPrivs):' /proc/self/status; touch /probe 2>/dev/null && echo writable || echo read-only; echo $HOME $CLAUDE_CONFIG_DIR",
    ]);
    expect(stdout).toMatch(/^Uid:\s+1000\s/m);
    expect(stdout).toMatch(/^CapEff:\s+0{16}$/m);
    expect(stdout).toMatch(/^NoNewPrivs:\s+1$/m);
    expect(stdout).toContain("read-only");
    expect(stdout).toContain("/home/claude /home/claude/.claude");
  });

  it("passes only the env names a request may set", async () => {
    const { stdout } = await run(["sh", "-c", "env"], {
      env: {
        ANTHROPIC_API_KEY: "sk-test",
        DATABASE_URL: "postgres://secret",
        PATH: "/nowhere",
      },
    });
    expect(stdout).toContain("ANTHROPIC_API_KEY=sk-test");
    expect(stdout).toContain("HTTPS_PROXY=http://egress.invalid:3128");
    expect(stdout).not.toContain("DATABASE_URL");
    expect(stdout).not.toContain("PATH=/nowhere");
  });

  it("reaches nothing outside its network", async () => {
    const { stdout } = await run([
      "node",
      "-e",
      "require('net').connect(443, '1.1.1.1').on('connect', () => console.log('open')).on('error', (e) => console.log(e.code))",
    ]);
    expect(stdout.trim()).not.toBe("open");
    expect(stdout.trim()).toMatch(/^E[A-Z]+$/);
  });

  it("keeps a person's state between sandboxes, and nothing for a one-shot", async () => {
    const state = `users/${PERSON}`;
    await run(["sh", "-c", "echo kept > $CLAUDE_CONFIG_DIR/probe"], { state });
    expect(
      (await run(["cat", "/home/claude/.claude/probe"], { state })).stdout,
    ).toBe("kept\n");
    expect(
      (
        await run([
          "sh",
          "-c",
          "cat $CLAUDE_CONFIG_DIR/probe 2>/dev/null || echo none",
        ])
      ).stdout,
    ).toBe("none\n");
  });

  it("refuses a request it does not accept, and starts nothing", async () => {
    const refusedState = await run(["cat"], { state: "users/../../etc" });
    expect(refusedState).toMatchObject({ exitCode: null });
    expect(refusedState.error).toMatch(/state folder/);
    expect(ownContainers()).toEqual([]);
  });

  it("removes the container when its client goes away", async () => {
    const sandbox = openSandbox(
      { kind: "claude", args: ["sleep", "300"], env: {} },
      { socketPath: settings.socketPath },
    );
    sandbox.on("error", () => {});
    await until(() => ownContainers().length === 1);
    const exited = exitOf(sandbox);
    sandbox.kill();
    expect(await exited).toEqual([null, "SIGKILL"]);
    await until(() => ownContainers().length === 0);
  });

  it("holds to its limit", async () => {
    const sleepers = [1, 2].map(() =>
      openSandbox(
        { kind: "claude", args: ["sleep", "300"], env: {} },
        { socketPath: settings.socketPath },
      ),
    );
    for (const sleeper of sleepers) sleeper.on("error", () => {});
    await until(() => launcher.running === 2);
    expect((await run(["cat"])).error).toBe("the sandbox limit is reached");
    for (const sleeper of sleepers) sleeper.kill();
    await until(() => launcher.running === 0 && ownContainers().length === 0);
  });

  it("removes its own leftovers when it starts", async () => {
    docker(
      "run",
      "-d",
      "--label",
      `tachy.sandbox=${settings.instance}`,
      IMAGE,
      "sleep",
      "300",
    );
    const neighbour = docker(
      "run",
      "-d",
      "--label",
      "tachy.sandbox=someone-else",
      IMAGE,
      "sleep",
      "300",
    );
    const second = await startLauncher(
      settingsFor(mkdtempSync(join(tmpdir(), "tachy-launcher-"))),
    );
    try {
      expect(ownContainers()).toEqual([]);
      expect(docker("ps", "-q", "--filter", `id=${neighbour}`)).not.toBe("");
    } finally {
      await second.close();
      docker("rm", "-f", neighbour);
    }
  });
});
