/**
 * A token handed to git must reach the remote and nowhere else. The remote here
 * is a local HTTP server that records the header it was sent and refuses it, so
 * every call fails the way a bad PAT or an unreachable host does.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HTTPException } from "hono/http-exception";
import { rememberSecret, sql } from "@tachy/core/infra";
import { createUser } from "@tachy/core/access";
import {
  addSourceConnection,
  addSourceProject,
  deleteSourceConnection,
} from "@tachy/core/sources";
import {
  deleteRepo,
  getRepoBySlug,
  indexRepo,
  linkRepo,
  listRemoteRefs,
} from "@tachy/core/code";
import {
  authEnv,
  ensureClone,
  fetchLine,
  withoutUrlCredentials,
} from "../../packages/core/src/code/git";

import { createApp, withSecretsMasked } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData } from "../database";

const TOKEN = "canary0pat1value2that3must4not5leak";
const ENCODED = Buffer.from(`:${TOKEN}`).toString("base64");

const expectClean = (text: string) => {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(ENCODED);
  expect(text).not.toContain("extraHeader");
};

const failure = async (call: () => Promise<unknown>): Promise<string> => {
  try {
    await call();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the git call to fail");
};

let server: Server;
let remote: string;
let dataDir: string;
let received: (string | undefined)[] = [];
/** Runs while git waits on the remote, which is when its processes are alive. */
let whileGitWaits: (() => void) | undefined;

/** The command line of every running git process, as any local user reads it. */
function gitCommandLines(): string[] {
  const commandLines: string[] = [];
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .split("\0")
        .join(" ");
      if (/(^|\/)git(-[a-z-]+)? /.test(commandLine))
        commandLines.push(commandLine);
    } catch {
      continue;
    }
  }
  return commandLines;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "tachy-repos-"));
  process.env.TACHY_REPO_DIR = dataDir;
  server = createServer((request, response) => {
    received.push(request.headers.authorization);
    whileGitWaits?.();
    response.writeHead(401).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  remote = `http://127.0.0.1:${port}/org/repo.git`;
});

afterAll(async () => {
  await deleteRepo("leaky").catch(() => {});
  await resetData();
  await deleteSourceConnection("canary-ado").catch(() => {});
  delete process.env.AZURE_DEVOPS_TOKEN_CANARY_ADO;
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.TACHY_REPO_DIR;
  await sql.end();
});

beforeEach(() => {
  received = [];
  whileGitWaits = undefined;
});

describe("git credentials", () => {
  it("sends the token as a header, from the environment", async () => {
    const message = await failure(() => listRemoteRefs(remote, TOKEN));
    expect(received).toContain(`Basic ${ENCODED}`);
    expect(message).toMatch(/^git ls-remote failed: /);
    expectClean(message);
  });

  it.skipIf(!existsSync("/proc/self/cmdline"))(
    "keeps the token off the command line of every git process",
    async () => {
      const seen: string[] = [];
      whileGitWaits = () => void seen.push(...gitCommandLines());
      await failure(() => listRemoteRefs(remote, TOKEN));
      const mine = seen.filter((commandLine) => commandLine.includes(remote));
      expect(mine.some((c) => c.includes("ls-remote"))).toBe(true);
      expectClean(mine.join("\n"));
    },
  );

  it("puts no config in the environment without a token", () => {
    expect(authEnv()).toEqual({});
    expect(authEnv(TOKEN).GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${ENCODED}`,
    );
  });

  it("keeps the token out of a failed clone and a failed fetch", async () => {
    const cloned = await failure(() =>
      ensureClone(
        { slug: "leaky-clone", url: remote, defaultBranch: "master" },
        TOKEN,
      ),
    );
    expect(cloned).toMatch(/^git clone failed: /);
    expectClean(cloned);
    expect(received).toContain(`Basic ${ENCODED}`);

    const fetched = await failure(() => fetchLine("no-clone", "master", TOKEN));
    expect(fetched).toMatch(/^git fetch failed: /);
    expectClean(fetched);
  });

  it("keeps the token out when the host does not resolve", async () => {
    const message = await failure(() =>
      listRemoteRefs("https://tachy-canary.invalid/org/repo.git", TOKEN),
    );
    expect(message).toMatch(/^git ls-remote failed: /);
    expectClean(message);
  });

  it("drops credentials embedded in a URL git quotes back", async () => {
    expect(
      withoutUrlCredentials(
        "fatal: unable to access 'https://user:hunter2hunter2@host/r.git/'",
      ),
    ).toBe("fatal: unable to access 'https://host/r.git/'");
    const message = await failure(() =>
      listRemoteRefs(remote.replace("://", `://user:${TOKEN}@`)),
    );
    expectClean(message);
  });

  it("stores and logs an index failure without the token", async () => {
    await linkRepo({ slug: "leaky", url: remote, defaultBranch: "master" });
    const written: string[] = [];
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => (written.push(String(chunk)), true));
    let message: string;
    try {
      message = await failure(() => indexRepo("leaky", { token: TOKEN }));
    } finally {
      write.mockRestore();
    }
    expectClean(message);
    expect(received).toContain(`Basic ${ENCODED}`);

    const repo = await getRepoBySlug("leaky");
    const stored = repo.lines.map((l) => l.index_error ?? "").join("\n");
    expect(stored).toMatch(/git clone failed/);
    expectClean(stored);
    expectClean(written.join(""));
  });

  it("answers /api/repos/refs for a refused remote without the token", async () => {
    const app = createApp({ passwordAuth: true });
    await createUser({
      email: "canary-admin@example.com",
      password: "a-long-password",
      role: "admin",
    });
    const cookie = await loginCookie(
      app,
      "canary-admin@example.com",
      "a-long-password",
    );
    await addSourceConnection({
      sourceType: "azure-devops",
      slug: "canary-ado",
      baseUrl: new URL(remote).origin,
    });
    process.env.AZURE_DEVOPS_TOKEN_CANARY_ADO = TOKEN;
    const project = await addSourceProject({
      sourceSlug: "canary-ado",
      externalKey: "canary-proj",
      productSlug: "tpd",
    });

    const response = await app.request(
      `/api/repos/refs?url=${encodeURIComponent(remote)}&source_project_id=${project.id}`,
      { headers: { Cookie: cookie } },
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(received).toContain(`Basic ${ENCODED}`);
    expect(JSON.parse(text)).toMatchObject({ ok: false });
    expect(text).toContain("git ls-remote failed");
    expectClean(text);
  });

  it("masks the body of an HTTPException response", async () => {
    rememberSecret(TOKEN);
    const thrown = new HTTPException(502, {
      message: `upstream refused ${TOKEN}`,
    });
    const response = await withSecretsMasked(thrown.getResponse());
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("upstream refused [SECRET]");
  });
});
