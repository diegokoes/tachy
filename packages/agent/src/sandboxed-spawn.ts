/**
 * Claude Code in a container per turn or one-shot, through the sandbox
 * launcher, when TACHY_TURN_SANDBOX is on. Off, the SDK starts it locally.
 * A turn's tools process follows the same switch (`turn-tools.ts`).
 */
import { relative } from "node:path";
import type {
  Options,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import { agentHome, log } from "@tachy/core/infra";
import { LAUNCHER_SOCKET, openSandbox } from "@tachy/sandbox";

export const isSandboxed = () => process.env.TACHY_TURN_SANDBOX === "on";

export const launcherSocket = () =>
  process.env.TACHY_SANDBOX_SOCKET ?? LAUNCHER_SOCKET;

/** A person's agent state folder as the launcher names it: `users/<id>`. */
export const stateNameOf = (configDir: string) =>
  relative(agentHome(), configDir);

const definedEnv = (env: SpawnOptions["env"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** `state` mounts that person's agent state; without it the sandbox keeps nothing. */
export function sandboxedSpawn(
  state?: string,
): (options: SpawnOptions) => SpawnedProcess {
  return (options) => {
    const sandbox = openSandbox(
      {
        kind: "claude",
        args: options.args,
        env: definedEnv(options.env),
        ...(state ? { state } : {}),
      },
      {
        socketPath: launcherSocket(),
        onStderr: (text) => log("debug", "sandbox_stderr", { text }),
      },
    );
    options.signal.addEventListener("abort", () => sandbox.kill(), {
      once: true,
    });
    return sandbox;
  };
}

export const sandboxOption = (
  state?: string,
): Pick<Options, "spawnClaudeCodeProcess"> =>
  isSandboxed() ? { spawnClaudeCodeProcess: sandboxedSpawn(state) } : {};
