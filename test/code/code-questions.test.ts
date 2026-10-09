/**
 * What the agent asks of a repo beyond search: one directory, what a commit
 * changed, which release it shipped in, and several repos at once. Against a
 * real git repo in a temp dir, through core, the MCP tools and the read route.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sql } from "@tachy/core/infra";
import { createUser } from "@tachy/core/access";
import { addSourceProject } from "@tachy/core/sources";
import {
  codeDiff,
  codeReleasesContaining,
  deleteRepo,
  indexRepo,
  linkRepo,
  listCodeDir,
  reposInProject,
  searchCode,
} from "@tachy/core/code";
import { server } from "../../packages/mcp/src/index";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";

let srcDir: string;
let dataDir: string;
let client: Client;
let fixSha: string;
let headSha: string;

const git = (args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd: srcDir },
  )
    .toString()
    .trim();

const commit = async (files: Record<string, string>, message: string) => {
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(srcDir, path)), { recursive: true });
    await writeFile(join(srcDir, path), body);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]);
};

const LOGIN = [
  "export function loginRedirectTarget(session: Session | null): string {",
  "  if (!session) return '/login';",
  "  return '/home';",
  "}",
  "",
].join("\n");

const GENERATED_FILES = 45;
/** In the history for the diff to be wide, and kept out of the index. */
const UNINDEXED = { exclude: ["gen"] };

async function call(name: string, args: Record<string, unknown> = {}) {
  const answer = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = answer.content[0]?.text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: answer.isError === true, text, json: json as never };
}

// master: init (v2.0.0) -- #77 fix (v2.0.1) -- generated (v2.1.0) -- wip
beforeAll(async () => {
  srcDir = await mkdtemp(join(tmpdir(), "tachy-q-src-"));
  dataDir = await mkdtemp(join(tmpdir(), "tachy-q-repos-"));
  process.env.TACHY_REPO_DIR = dataDir;

  git(["init", "-q", "-b", "master"]);
  git(["config", "uploadpack.allowFilter", "true"]);
  git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
  await commit(
    {
      "README.md": "# portal\n",
      "src/login.ts": LOGIN,
      "src/session.ts": "export interface Session { user: string }\n",
    },
    "init",
  );
  git(["tag", "v2.0.0"]);
  fixSha = await commit(
    { "src/login.ts": LOGIN.replace("'/home'", "'/dashboard'") },
    "#77 fix login loop",
  );
  git(["tag", "v2.0.1"]);
  const generated: Record<string, string> = {};
  for (let i = 0; i < GENERATED_FILES; i++)
    generated[`gen/f${i}.ts`] = `export const generated${i} = ${i};\n`;
  await commit(generated, "generated");
  git(["tag", "v2.1.0"]);
  headSha = await commit({ "src/wip.ts": "export const WIP = 1;\n" }, "wip");

  const project = await addSourceProject({
    sourceSlug: "test-freshdesk",
    externalKey: "Portal Mobile",
    productSlug: "tpd",
  });
  await linkRepo({
    slug: "qrepo",
    url: `file://${srcDir}`,
    defaultBranch: "master",
    sourceSlug: "test-freshdesk",
    config: UNINDEXED,
  });
  await linkRepo({
    slug: "qrepo-mobile",
    url: `file://${srcDir}`,
    defaultBranch: "master",
    sourceSlug: "test-freshdesk",
    sourceProjectId: project.id,
    config: UNINDEXED,
  });
  await indexRepo("qrepo");
  await indexRepo("qrepo-mobile");

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
}, 300_000);

afterAll(async () => {
  await client?.close();
  await deleteRepo("qrepo").catch(() => {});
  await deleteRepo("qrepo-mobile").catch(() => {});
  await sql`delete from source_projects where external_key = 'Portal Mobile'`;
  await rm(srcDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.TACHY_REPO_DIR;
  await sql.end();
});

describe("listCodeDir", () => {
  it("lists one level, directories first", async () => {
    const root = await listCodeDir("qrepo", "");
    expect(root.entries).toEqual([
      { name: "gen", kind: "dir" },
      { name: "src", kind: "dir" },
      { name: "README.md", kind: "file" },
    ]);
    expect(root.ref).toBe("master");
    expect(root.truncated).toBe(false);

    const src = await listCodeDir("qrepo", "/src/");
    expect(src.path).toBe("src");
    expect(src.entries.map((e) => e.name)).toEqual([
      "login.ts",
      "session.ts",
      "wip.ts",
    ]);
  });

  it("lists the tree a release shipped", async () => {
    const released = await listCodeDir("qrepo", "", { version: "2.0.0" });
    expect(released.ref).toBe("v2.0.0");
    expect(released.entries.map((e) => e.name)).toEqual(["src", "README.md"]);
  });

  it("refuses a path that is no directory", async () => {
    await expect(listCodeDir("qrepo", "nowhere")).rejects.toThrow(
      "is not a directory",
    );
  });
});

describe("codeDiff", () => {
  it("shows what one commit changed, named by an abbreviated id", async () => {
    const diff = await codeDiff("qrepo", { commit: fixSha.slice(0, 8) });
    expect(diff.to).toBe(fixSha);
    expect(diff.commit?.subject).toBe("#77 fix login loop");
    expect(diff.files).toEqual([{ status: "M", path: "src/login.ts" }]);
    expect(diff.patch).toContain("+  return '/dashboard';");
    expect(diff.patch).toContain("-  return '/home';");
    expect(diff.truncated).toBe(false);
  });

  it("diffs a root commit against nothing", async () => {
    const first = git(["rev-list", "--max-parents=0", "HEAD"]);
    const diff = await codeDiff("qrepo", { commit: first });
    expect(diff.files.map((f) => f.status)).toEqual(["A", "A", "A"]);
  });

  it("compares two releases", async () => {
    const diff = await codeDiff("qrepo", { from: "2.0.0", to: "v2.0.1" });
    expect(diff.commit).toBeUndefined();
    expect(diff.files).toEqual([{ status: "M", path: "src/login.ts" }]);
  });

  it("lists the files and leaves the patch out when there are too many", async () => {
    const wide = await codeDiff("qrepo", { from: "2.0.1", to: "2.1.0" });
    expect(wide.files).toHaveLength(GENERATED_FILES);
    expect(wide.patch).toBeNull();
    expect(wide.truncated).toBe(true);

    const narrowed = await codeDiff("qrepo", {
      from: "2.0.1",
      to: "2.1.0",
      path: "gen/f1.ts",
    });
    expect(narrowed.files).toEqual([{ status: "A", path: "gen/f1.ts" }]);
    expect(narrowed.patch).toContain("generated1");
  });

  it("refuses a range it cannot resolve", async () => {
    await expect(codeDiff("qrepo", { from: "2.0.0" })).rejects.toThrow(
      "needs a commit",
    );
    await expect(
      codeDiff("qrepo", { from: "2.0.0", to: "feature/unfetched" }),
    ).rejects.toThrow("has no commit, release, branch or tag");
  });
});

describe("codeReleasesContaining", () => {
  it("names the first release, and the first on each minor", async () => {
    const found = await codeReleasesContaining("qrepo", fixSha.slice(0, 10));
    expect(found.commit.sha).toBe(fixSha);
    expect(found.first_release).toBe("v2.0.1");
    expect(found.first_per_minor).toEqual(["v2.0.1", "v2.1.0"]);
    expect(found.lines).toEqual([{ ref: "master", contains: true }]);
  });

  it("says a commit has not shipped", async () => {
    const found = await codeReleasesContaining("qrepo", headSha);
    expect(found.first_release).toBeNull();
    expect(found.first_per_minor).toEqual([]);
  });

  it("refuses a commit the clone does not have", async () => {
    await expect(
      codeReleasesContaining("qrepo", "deadbeefdeadbeef"),
    ).rejects.toThrow("has no commit");
  });
});

describe("scope", () => {
  it("finds a project's repos by its key in either spelling", async () => {
    for (const name of ["Portal Mobile", "portal-mobile"])
      expect((await reposInProject(name)).map((r) => r.slug)).toEqual([
        "qrepo-mobile",
      ]);
    await expect(reposInProject("nothing-here")).rejects.toThrow(
      "No linked repo",
    );
  });

  it("searches only the repos named", async () => {
    const one = await searchCode("loginRedirectTarget", {
      repoSlugs: ["qrepo-mobile"],
    });
    expect(one.length).toBeGreaterThan(0);
    expect(new Set(one.map((h) => h.repo_slug))).toEqual(
      new Set(["qrepo-mobile"]),
    );

    const both = await searchCode("loginRedirectTarget", {
      repoSlug: "qrepo",
      repoSlugs: ["qrepo-mobile"],
      limit: 20,
    });
    expect(new Set(both.map((h) => h.repo_slug))).toEqual(
      new Set(["qrepo", "qrepo-mobile"]),
    );
  });
});

describe("the tools", () => {
  it("list_repos and search_code take a project", async () => {
    const listed = await call("list_repos", { project: "Portal-Mobile" });
    expect((listed.json as { slug: string }[]).map((r) => r.slug)).toEqual([
      "qrepo-mobile",
    ]);

    const hits = await call("search_code", {
      query: "loginRedirectTarget",
      project: "Portal-Mobile",
    });
    const repos = (hits.json as { repo: string }[]).map((h) => h.repo);
    expect(repos.length).toBeGreaterThan(0);
    expect(new Set(repos)).toEqual(new Set(["qrepo-mobile"]));
  });

  it("search_code refuses a repo that is not linked", async () => {
    const answer = await call("search_code", {
      query: "login",
      repos: ["qrepo", "not-linked"],
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("not-linked");
  });

  it("list_code_tree, code_diff and code_releases_containing answer", async () => {
    const tree = await call("list_code_tree", { repo: "qrepo", path: "src" });
    expect(
      (tree.json as { entries: { name: string }[] }).entries.map((e) => e.name),
    ).toContain("login.ts");

    const diff = await call("code_diff", { repo: "qrepo", commit: fixSha });
    expect((diff.json as { patch: string }).patch).toContain("/dashboard");

    const releases = await call("code_releases_containing", {
      repo: "qrepo",
      commit: fixSha,
    });
    expect((releases.json as { first_release: string }).first_release).toBe(
      "v2.0.1",
    );
  });

  it("code_changes_between points at the tools that read a commit", async () => {
    const changes = await call("code_changes_between", {
      repo: "qrepo",
      from_version: "2.0.0",
      to_version: "2.0.1",
    });
    expect((changes.json as { next: string }).next).toContain("code_diff");
  });

  it("show_code_walkthrough checks the ranges and returns no code", async () => {
    const step = {
      label: "redirect",
      repo: "qrepo",
      path: "src/login.ts",
      start_line: 1,
      end_line: 3,
      highlight: [[2, 2]],
      note: "A missing session goes back to the login page.",
    };
    const shown = await call("show_code_walkthrough", {
      title: "login redirect",
      steps: [step],
    });
    expect(shown.isError).toBe(false);
    expect((shown.json as { shown: unknown[] }).shown).toEqual([
      expect.objectContaining({
        path: "src/login.ts",
        ref: "master",
        start_line: 1,
        end_line: 3,
      }),
    ]);
    expect(shown.text).not.toContain("loginRedirectTarget");

    const tooLong = await call("show_code_walkthrough", {
      title: "t",
      steps: [{ ...step, end_line: 200 }],
    });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.text).toContain("more than 60 lines");

    const pastTheEnd = await call("show_code_walkthrough", {
      title: "t",
      steps: [{ ...step, start_line: 400, end_line: 410 }],
    });
    expect(pastTheEnd.isError).toBe(true);
  });
});

describe("over HTTP", () => {
  const app = createApp({ passwordAuth: true });
  let cookie: string;

  beforeAll(async () => {
    await createUser({
      email: "code-reader@example.com",
      password: "a-long-password",
    });
    cookie = await loginCookie(
      app,
      "code-reader@example.com",
      "a-long-password",
    );
  });

  afterAll(
    () => sql`delete from users where email = 'code-reader@example.com'`,
  );

  it("lists /code with its scope and leaves the walkthrough out", async () => {
    const response = await app.request("/api/agent/commands", {
      headers: { Cookie: cookie },
    });
    const { builtins } = (await response.json()) as {
      builtins: { name: string; args: string }[];
    };
    expect(builtins.find((b) => b.name === "code")?.args).toContain("@repo");
    expect(builtins.map((b) => b.name)).not.toContain("walkthrough");
  });

  it("returns the numbered lines of a range", async () => {
    const response = await app.request(
      "/api/repos/qrepo/file?path=src/login.ts&start=2&end=3&version=2.0.0",
      { headers: { Cookie: cookie } },
    );
    expect(response.status).toBe(200);
    const file = await response.json();
    expect(file.ref).toBe("v2.0.0");
    expect(file.content).toBe(
      "2\t  if (!session) return '/login';\n3\t  return '/home';",
    );

    // A file:// remote has no page to link to.
    expect(file.web_url).toBeNull();

    const missing = await app.request("/api/repos/qrepo/file", {
      headers: { Cookie: cookie },
    });
    expect(missing.status).toBe(400);
  });
});
