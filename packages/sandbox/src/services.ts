/** The launcher and the egress proxy as services: their settings come from the environment. */
import type { Server } from "node:http";
import type { ToolsSandboxSettings } from "./container-spec";
import { DockerEngine } from "./docker";
import {
  DEFAULT_EGRESS,
  parseDestinations,
  startEgressProxy,
  type EgressSettings,
} from "./egress-proxy";
import {
  startLauncher,
  type Launcher,
  type LauncherSettings,
} from "./launcher";

type Env = Record<string, string | undefined>;

export const LAUNCHER_SOCKET = "/run/tachy-sandbox/launcher.sock";
const DEFAULT_PROXY_URL = "http://egress:3128";
const DEFAULT_EGRESS_PORT = 3128;
const DEFAULT_MEMORY_MB = 512;
const DEFAULT_PIDS_LIMIT = 256;
const DEFAULT_CPUS = 1;
const DEFAULT_MAX_SANDBOXES = 32;
const DEFAULT_TOOLS_MEMORY_MB = 512;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function positiveNumber(env: Env, name: string, fallback: number): number {
  const text = env[name]?.trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number, not '${text}'`);
  return value;
}

/** Without TACHY_TOOLS_IMAGE the launcher refuses a tools sandbox. */
function toolsSettingsFromEnv(env: Env): ToolsSandboxSettings | undefined {
  const image = env.TACHY_TOOLS_IMAGE?.trim();
  if (!image) return undefined;
  return {
    image,
    network: required(env, "TACHY_TOOLS_NETWORK"),
    repoVolume: required(env, "TACHY_TOOLS_REPO_VOLUME"),
    memoryMb: positiveNumber(
      env,
      "TACHY_TOOLS_MEMORY_MB",
      DEFAULT_TOOLS_MEMORY_MB,
    ),
    pidsLimit: positiveNumber(env, "TACHY_TOOLS_PIDS", DEFAULT_PIDS_LIMIT),
    cpus: positiveNumber(env, "TACHY_TOOLS_CPUS", DEFAULT_CPUS),
  };
}

export function launcherSettingsFromEnv(env: Env): LauncherSettings {
  const tools = toolsSettingsFromEnv(env);
  const runtime = env.TACHY_SANDBOX_RUNTIME?.trim();
  return {
    instance: env.TACHY_SANDBOX_INSTANCE?.trim() || "tachy",
    ...(runtime ? { runtime } : {}),
    image: required(env, "TACHY_SANDBOX_IMAGE"),
    network: required(env, "TACHY_SANDBOX_NETWORK"),
    stateVolume: required(env, "TACHY_SANDBOX_STATE_VOLUME"),
    proxyUrl: env.TACHY_SANDBOX_PROXY_URL?.trim() || DEFAULT_PROXY_URL,
    memoryMb: positiveNumber(env, "TACHY_SANDBOX_MEMORY_MB", DEFAULT_MEMORY_MB),
    pidsLimit: positiveNumber(env, "TACHY_SANDBOX_PIDS", DEFAULT_PIDS_LIMIT),
    cpus: positiveNumber(env, "TACHY_SANDBOX_CPUS", DEFAULT_CPUS),
    socketPath: env.TACHY_SANDBOX_SOCKET?.trim() || LAUNCHER_SOCKET,
    dockerSocket: env.TACHY_DOCKER_SOCKET?.trim() || "/var/run/docker.sock",
    maxSandboxes: positiveNumber(
      env,
      "TACHY_SANDBOX_MAX",
      DEFAULT_MAX_SANDBOXES,
    ),
    ...(tools ? { tools } : {}),
  };
}

export function egressSettingsFromEnv(env: Env): EgressSettings {
  const listed = parseDestinations(env.TACHY_SANDBOX_EGRESS ?? "");
  return {
    host: "0.0.0.0",
    port: positiveNumber(env, "TACHY_EGRESS_PORT", DEFAULT_EGRESS_PORT),
    allowed: listed.length ? listed : DEFAULT_EGRESS,
  };
}

/** The images are pulled first if the daemon lacks them, so a deploy need not. */
export async function runLauncher(env: Env): Promise<Launcher> {
  const settings = launcherSettingsFromEnv(env);
  const docker = new DockerEngine(settings.dockerSocket);
  await docker.ensureImage(settings.image);
  if (settings.tools) await docker.ensureImage(settings.tools.image);
  return startLauncher(settings);
}

export const runEgressProxy = (env: Env): Promise<Server> =>
  startEgressProxy(egressSettingsFromEnv(env));
