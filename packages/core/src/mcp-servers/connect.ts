import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  DIR_PLACEHOLDER,
  TOKEN_PLACEHOLDER,
  type McpHttpConfig,
  type McpServerRow,
  type McpStdioConfig,
} from "@tachy/contract";
import { log } from "../infra/log";
import { errorText, maskSecrets, rememberSecret } from "../infra/known-secrets";
import { assertStdioCommandAllowed } from "./servers";

const CLIENT_INFO = { name: "tachy", version: "0.1.0" };

export interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

export function renderTemplate(
  template: string,
  values: { token: string; dir?: string },
): string {
  const withToken = template.replaceAll(TOKEN_PLACEHOLDER, values.token);
  return values.dir === undefined
    ? withToken
    : withToken.replaceAll(DIR_PLACEHOLDER, values.dir);
}

function renderRecord(
  record: Record<string, string> | undefined,
  values: { token: string; dir?: string },
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([name, template]) => [
      name,
      rememberSecret(renderTemplate(template, values)),
    ]),
  );
}

async function connectHttp(
  config: McpHttpConfig,
  token: string,
  timeoutMs: number,
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: renderRecord(config.headers, { token }) },
  });
  const client = new Client(CLIENT_INFO);
  await client.connect(transport, { timeout: timeoutMs });
  return { client, close: () => client.close() };
}

/** The connection's own directory: files it is given, and its working directory. */
async function prepareDirectory(
  config: McpStdioConfig,
  token: string,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "tachy-mcp-"));
  for (const file of config.files ?? []) {
    const path = join(dir, file.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, renderTemplate(file.content, { token, dir }), {
      mode: 0o600,
    });
  }
  return dir;
}

async function connectStdio(
  config: McpStdioConfig,
  token: string,
  timeoutMs: number,
): Promise<McpConnection> {
  assertStdioCommandAllowed(config.command);
  const dir = await prepareDirectory(config, token);
  const removeDir = () => rmSync(dir, { recursive: true, force: true });
  process.once("exit", removeDir);
  const values = { token, dir };
  // Only the SDK's short list of login variables is inherited, never the
  // process env, which holds the database URL and every caller's tokens.
  const transport = new StdioClientTransport({
    command: config.command,
    args: (config.args ?? []).map((arg) => renderTemplate(arg, values)),
    env: { ...getDefaultEnvironment(), ...renderRecord(config.env, values) },
    cwd: dir,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) =>
    log("debug", "mcp_server_stderr", {
      command: config.command,
      text: maskSecrets(chunk.toString()),
    }),
  );
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (err) {
    removeDir();
    throw err;
  }
  return {
    client,
    close: async () => {
      await client.close();
      removeDir();
      process.off("exit", removeDir);
    },
  };
}

/** A connected client for one server, authenticated with one credential. */
export function openConnection(
  server: Pick<McpServerRow, "transport" | "config" | "call_timeout_ms">,
  token: string,
): Promise<McpConnection> {
  return server.transport === "http"
    ? connectHttp(server.config as McpHttpConfig, token, server.call_timeout_ms)
    : connectStdio(
        server.config as McpStdioConfig,
        token,
        server.call_timeout_ms,
      );
}

export type FailureKind = "rate_limited" | "auth" | "other";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_AUTH_REFUSED = [401, 403];

/** A connect or list failure as the console shows it. */
export function connectFailureText(err: unknown): string {
  if (!(err instanceof StreamableHTTPError)) return errorText(err);
  if (err.code !== undefined && HTTP_AUTH_REFUSED.includes(err.code))
    return `the server refused the token (HTTP ${err.code})`;
  return `the server answered HTTP ${err.code}: ${errorText(err)}`;
}

/** What a failed call means for its credential. */
export function classifyFailure(
  err: unknown,
  rateLimitCodes: number[],
): FailureKind {
  if (err instanceof StreamableHTTPError) {
    if (err.code === HTTP_TOO_MANY_REQUESTS) return "rate_limited";
    if (err.code !== undefined && HTTP_AUTH_REFUSED.includes(err.code))
      return "auth";
  }
  if (err instanceof McpError && rateLimitCodes.includes(err.code))
    return "rate_limited";
  return "other";
}
