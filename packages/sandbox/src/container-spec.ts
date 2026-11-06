/**
 * The containers a sandbox can be. A request picks a kind, a few named env
 * values and, for Claude Code, its arguments and the person's state folder;
 * the image, user, mounts, network and limits come from the deployment.
 */
import type { SandboxRequest } from "./protocol";

export interface SandboxLimits {
  memoryMb: number;
  pidsLimit: number;
  cpus: number;
}

export interface ClaudeSandboxSettings extends SandboxLimits {
  /** Labels this deployment's sandboxes, so a launcher removes only its own. */
  instance: string;
  image: string;
  network: string;
  /** The Docker volume holding each person's agent state under `users/<id>`. */
  stateVolume: string;
  /** Claude Code's HTTPS goes through this proxy, the network's only way out. */
  proxyUrl: string;
}

/** The turn's tools process: tachy's own image, on the network the database is on. */
export interface ToolsSandboxSettings extends SandboxLimits {
  image: string;
  network: string;
  /** The Docker volume holding the linked repositories' clones. */
  repoVolume: string;
}

export const SANDBOX_LABEL = "tachy.sandbox";

/** The owner of the files the api and the workers write, so a mounted folder stays writable. */
const SANDBOX_UID = 1000;
const HOME_DIR = "/home/claude";
const STATE_DIR = `${HOME_DIR}/.claude`;
/** Claude Code files transcripts by cwd: the api's own working directory, so a session resumes in either. */
const WORKING_DIR = "/app";
const TOOLS_COMMAND = ["node", "dist/mcp.js"];
/** The clones' mount, as the image lays it out (TACHY_REPO_DIR). */
const REPO_DATA_DIR = "/app/data";
const TOOLS_HEAP_MB = 256;
const TMP_MOUNT_OPTIONS = "size=256m";
const HOME_MOUNT_OPTIONS = `size=64m,uid=${SANDBOX_UID},gid=${SANDBOX_UID}`;
const BYTES_PER_MB = 1024 * 1024;
const NANO_CPUS_PER_CPU = 1e9;
const MAX_ARGS = 64;
const MAX_ARG_CHARS = 64 * 1024;
const MAX_ENV_VALUE_CHARS = 16 * 1024;
/** The JSON of a turn's linked-server tokens is one value and can be long. */
const MAX_TOOLS_ENV_VALUE_CHARS = 64 * 1024;
const STATE_RE =
  /^users\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|_default)$/;

/** The env names a Claude Code request may set; the rest of its env is fixed. */
const CLAUDE_ENV = new Set([
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

/** What the api builds for a turn's tools process (`mcpConfig`), less what the container fixes. */
const TOOLS_ENV = new Set([
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "TEST_SCHEMA",
  "TACHY_DB_POOL_MAX",
  "TACHY_DB_IDLE_TIMEOUT",
  "TACHY_DB_APP_NAME",
  "TACHY_EMBED_URL",
  "TACHY_EMBED_MODEL",
  "TACHY_LOG_URL",
  "TACHY_INTERNAL_SECRET",
  "TACHY_PUBLIC_ORIGIN",
  "TACHY_USER_EMAIL",
  "TACHY_ACTOR",
  "TACHY_ACTOR_ROLE",
  "TACHY_TURN_ID",
  "TACHY_REQUEST_ID",
  "TACHY_UPLOAD_OWNER",
  "TACHY_UPLOAD_MAX_MB",
  "TACHY_UPLOAD_IMAGE_MAX_MB",
  "TACHY_OUTPUT_TTL_HOURS",
  "TACHY_DATE_FORMAT",
  "TACHY_REDACT",
  "TACHY_REDACT_IMAGES",
  "TACHY_MCP_STDIO_COMMANDS",
  "TACHY_MCP_SERVER_TOKENS",
]);
/** A source connection's token, `<SOURCE>_TOKEN_<SLUG>`. */
const SOURCE_TOKEN_ENV_RE = /^[A-Z][A-Z0-9_]*_TOKEN_[A-Z0-9_]+$/;

interface VolumeMount {
  Type: "volume";
  Source: string;
  Target: string;
  VolumeOptions?: { Subpath: string };
}

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
    Mounts: VolumeMount[];
    LogConfig: { Type: "none"; Config: Record<string, never> };
  };
}

function assertArgs(args: string[]): void {
  if (args.length > MAX_ARGS) throw new Error(`more than ${MAX_ARGS} args`);
  if (args.some((arg) => arg.length > MAX_ARG_CHARS || arg.includes("\0")))
    throw new Error("an arg is too long or holds a NUL");
}

function allowedEnv(
  env: Record<string, string>,
  isAllowed: (name: string) => boolean,
  maxValueChars: number,
): string[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        isAllowed(name) &&
        value.length <= maxValueChars &&
        !value.includes("\0"),
    )
    .map(([name, value]) => `${name}=${value}`);
}

/** Everything a sandbox shares, whatever runs in it. */
function lockedDown(
  instance: string,
  shape: Pick<ContainerSpec, "Image" | "Cmd" | "Env"> & {
    limits: SandboxLimits;
    network: string;
    tmpfs: Record<string, string>;
    mounts: VolumeMount[];
  },
): ContainerSpec {
  const memoryBytes = shape.limits.memoryMb * BYTES_PER_MB;
  return {
    Image: shape.Image,
    Cmd: shape.Cmd,
    Env: shape.Env,
    User: `${SANDBOX_UID}:${SANDBOX_UID}`,
    WorkingDir: WORKING_DIR,
    Labels: { [SANDBOX_LABEL]: instance },
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
      PidsLimit: shape.limits.pidsLimit,
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(shape.limits.cpus * NANO_CPUS_PER_CPU),
      IpcMode: "private",
      NetworkMode: shape.network,
      Tmpfs: shape.tmpfs,
      Mounts: shape.mounts,
      // The stream is the conversation, ticket text included: never on disk.
      LogConfig: { Type: "none", Config: {} },
    },
  };
}

export function claudeSandboxSpec(
  request: SandboxRequest,
  settings: ClaudeSandboxSettings,
): ContainerSpec {
  assertArgs(request.args);
  if (request.state !== undefined && !STATE_RE.test(request.state))
    throw new Error(`'${request.state}' is not a person's state folder`);
  return lockedDown(settings.instance, {
    Image: settings.image,
    Cmd: request.args,
    Env: [
      ...allowedEnv(
        request.env,
        (name) => CLAUDE_ENV.has(name),
        MAX_ENV_VALUE_CHARS,
      ),
      `HOME=${HOME_DIR}`,
      `CLAUDE_CONFIG_DIR=${STATE_DIR}`,
      `HTTPS_PROXY=${settings.proxyUrl}`,
    ],
    limits: settings,
    network: settings.network,
    tmpfs: { "/tmp": TMP_MOUNT_OPTIONS, [HOME_DIR]: HOME_MOUNT_OPTIONS },
    mounts: request.state
      ? [
          {
            Type: "volume",
            Source: settings.stateVolume,
            Target: STATE_DIR,
            VolumeOptions: { Subpath: request.state },
          },
        ]
      : [],
  });
}

/**
 * The tools process for one turn. Its command is fixed, so a request carries
 * no arguments and no state. The clones are mounted writable: a partial clone
 * fetches a file's contents when a tool first reads it.
 */
export function toolsSandboxSpec(
  request: SandboxRequest,
  instance: string,
  settings: ToolsSandboxSettings,
): ContainerSpec {
  if (request.args.length || request.state !== undefined)
    throw new Error("a tools sandbox takes no arguments and no state");
  return lockedDown(instance, {
    Image: settings.image,
    Cmd: TOOLS_COMMAND,
    Env: [
      ...allowedEnv(
        request.env,
        (name) => TOOLS_ENV.has(name) || SOURCE_TOKEN_ENV_RE.test(name),
        MAX_TOOLS_ENV_VALUE_CHARS,
      ),
      `NODE_OPTIONS=--max-old-space-size=${TOOLS_HEAP_MB}`,
      `TACHY_REPO_DIR=${REPO_DATA_DIR}/repos`,
    ],
    limits: settings,
    network: settings.network,
    tmpfs: { "/tmp": TMP_MOUNT_OPTIONS },
    mounts: [
      { Type: "volume", Source: settings.repoVolume, Target: REPO_DATA_DIR },
    ],
  });
}
