/**
 * The one container a sandbox can be. A request picks its arguments, a few
 * named env values and the person's state folder; the image, user, mounts,
 * network and limits come from the deployment.
 */
import type { SandboxRequest } from "./protocol";

export interface SandboxSettings {
  /** Labels this deployment's sandboxes, so a launcher removes only its own. */
  instance: string;
  image: string;
  network: string;
  /** The Docker volume holding each person's agent state under `users/<id>`. */
  stateVolume: string;
  /** Claude Code's HTTPS goes through this proxy, the network's only way out. */
  proxyUrl: string;
  memoryMb: number;
  pidsLimit: number;
  cpus: number;
}

export const SANDBOX_LABEL = "tachy.sandbox";

/** The owner of the agent state files the api writes, so a mounted state folder stays writable. */
const SANDBOX_UID = 1000;
const HOME_DIR = "/home/claude";
const STATE_DIR = `${HOME_DIR}/.claude`;
/** Claude Code files transcripts by cwd: the api's own working directory, so a session resumes in either. */
const WORKING_DIR = "/app";
const TMP_MOUNT_OPTIONS = "size=256m";
const HOME_MOUNT_OPTIONS = `size=64m,uid=${SANDBOX_UID},gid=${SANDBOX_UID}`;
const BYTES_PER_MB = 1024 * 1024;
const NANO_CPUS_PER_CPU = 1e9;
const MAX_ARGS = 64;
const MAX_ARG_CHARS = 64 * 1024;
const MAX_ENV_VALUE_CHARS = 16 * 1024;
const STATE_RE =
  /^users\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|_default)$/;

/** The env names a request may set; the rest of the sandbox's env is fixed. */
const REQUEST_ENV = new Set([
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "LANG",
  "LC_ALL",
  "TZ",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "ENABLE_CLAUDEAI_MCP_SERVERS",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SDK_READS_SESSION_STATE",
]);

/** The Docker Engine create body, as far as a sandbox fills it. */
export interface ContainerSpec {
  Image: string;
  Cmd: string[];
  Env: string[];
  User: string;
  WorkingDir: string;
  Labels: Record<string, string>;
  AttachStdin: true;
  AttachStdout: true;
  AttachStderr: true;
  OpenStdin: true;
  StdinOnce: true;
  Tty: false;
  HostConfig: {
    AutoRemove: true;
    ReadonlyRootfs: true;
    CapDrop: ["ALL"];
    SecurityOpt: string[];
    PidsLimit: number;
    Memory: number;
    MemorySwap: number;
    NanoCpus: number;
    IpcMode: "private";
    NetworkMode: string;
    Tmpfs: Record<string, string>;
    Mounts: {
      Type: "volume";
      Source: string;
      Target: string;
      VolumeOptions: { Subpath: string };
    }[];
    LogConfig: { Type: "none"; Config: Record<string, never> };
  };
}

function assertArgs(args: string[]): void {
  if (args.length > MAX_ARGS) throw new Error(`more than ${MAX_ARGS} args`);
  if (args.some((arg) => arg.length > MAX_ARG_CHARS || arg.includes("\0")))
    throw new Error("an arg is too long or holds a NUL");
}

const requestEnv = (env: Record<string, string>): string[] =>
  Object.entries(env)
    .filter(
      ([name, value]) =>
        REQUEST_ENV.has(name) &&
        value.length <= MAX_ENV_VALUE_CHARS &&
        !value.includes("\0"),
    )
    .map(([name, value]) => `${name}=${value}`);

export function claudeSandboxSpec(
  request: SandboxRequest,
  settings: SandboxSettings,
): ContainerSpec {
  assertArgs(request.args);
  if (request.state !== undefined && !STATE_RE.test(request.state))
    throw new Error(`'${request.state}' is not a person's state folder`);
  const memoryBytes = settings.memoryMb * BYTES_PER_MB;
  return {
    Image: settings.image,
    Cmd: request.args,
    Env: [
      ...requestEnv(request.env),
      `HOME=${HOME_DIR}`,
      `CLAUDE_CONFIG_DIR=${STATE_DIR}`,
      `HTTPS_PROXY=${settings.proxyUrl}`,
    ],
    User: `${SANDBOX_UID}:${SANDBOX_UID}`,
    WorkingDir: WORKING_DIR,
    Labels: { [SANDBOX_LABEL]: settings.instance },
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,
    HostConfig: {
      AutoRemove: true,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: settings.pidsLimit,
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(settings.cpus * NANO_CPUS_PER_CPU),
      IpcMode: "private",
      NetworkMode: settings.network,
      Tmpfs: { "/tmp": TMP_MOUNT_OPTIONS, [HOME_DIR]: HOME_MOUNT_OPTIONS },
      Mounts: request.state
        ? [
            {
              Type: "volume",
              Source: settings.stateVolume,
              Target: STATE_DIR,
              VolumeOptions: { Subpath: request.state },
            },
          ]
        : [],
      // The stream is the conversation, ticket text included: never on disk.
      LogConfig: { Type: "none", Config: {} },
    },
  };
}
