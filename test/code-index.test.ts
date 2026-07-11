import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sql,
  linkRepo,
  listRepos,
  getRepoBySlug,
  indexRepo,
  searchCode,
  readCodeFile,
  deleteRepo,
  chunkCode,
} from "@tachy/core";

let srcDir: string;
let dataDir: string;

const git = (args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd: srcDir },
  );

beforeAll(async () => {
  srcDir = await mkdtemp(join(tmpdir(), "tachy-src-"));
  dataDir = await mkdtemp(join(tmpdir(), "tachy-repos-"));
  process.env.TACHY_REPO_DIR = dataDir;

  git(["init", "-b", "main"]);
  await writeFile(
    join(srcDir, "printer.ts"),
    [
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
    ].join("\n"),
  );
  await writeFile(join(srcDir, "ignore.bin"), Buffer.from([0, 1, 2]));
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
});

afterAll(async () => {
  await deleteRepo("testrepo").catch(() => {});
  await rm(srcDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.TACHY_REPO_DIR;
});

describe("code indexing + search", () => {
  it("links, indexes, searches, and reads a repo end to end", async () => {
    await linkRepo({ slug: "testrepo", url: `file://${srcDir}` });
    const repos = await listRepos();
    expect(repos.some((r) => r.slug === "testrepo")).toBe(true);

    const res = await indexRepo("testrepo");
    expect(res.upToDate).toBe(false);
    expect(res.filesIndexed).toBe(1);
    expect(res.chunkCount).toBeGreaterThan(0);

    const repo = await getRepoBySlug("testrepo");
    expect(repo.index_status).toBe("ready");
    expect(repo.indexed_commit).toBe(res.indexedCommit);

    const hits = await searchCode("TOO_MANY_STRINGS printer buffer");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe("printer.ts");
    expect(hits[0].indexed_commit).toBe(res.indexedCommit);

    const read = await readCodeFile("testrepo", "printer.ts", {
      startLine: 1,
      endLine: 3,
    });
    expect(read.content.split("\n")).toHaveLength(3);
    expect(read.content).toContain("resolvePrinterBuffer");
    expect(read.truncated).toBe(true);
  });

  it("re-indexes only changed files and drops deleted ones", async () => {
    await writeFile(join(srcDir, "queue.ts"), "export const Q = 1;\n");
    git(["add", "-A"]);
    git(["rm", "-q", "ignore.bin"]);
    git(["commit", "-m", "add queue"]);

    const res = await indexRepo("testrepo");
    expect(res.filesIndexed).toBe(1);

    const again = await indexRepo("testrepo");
    expect(again.upToDate).toBe(true);

    const [files] = await sql`
      select count(*)::int as n from repo_files
      where repo_id = (select id from repos where slug = 'testrepo')
    `;
    expect(files.n).toBe(2);
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
