/**
 * searchCode given the exact terms of a long ticket: each term matches as a
 * whole on the keyword legs, a quoted message with an "or" in it included.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteRepo, indexRepo, linkRepo, searchCode } from "@tachy/core/code";
import { resetData, sql } from "../database";

const REPO = "terms-repo";

const FILES: Record<string, string> = {
  "src/open-file.ts": [
    "export function openOrFail(path: string) {",
    "  if (!exists(path)) throw new Error(`No such file or directory: ${path}`);",
    "  return read(path);",
    "}",
    "",
  ].join("\n"),
  "src/paths.ts": [
    "/** The directory a path sits in. */",
    "export function parentDirectory(path: string): string {",
    "  return path.slice(0, path.lastIndexOf('/'));",
    "}",
    "",
  ].join("\n"),
  "src/retry.ts": [
    "export const RETRY_CODE = 'ERR_RETRY_LIMIT';",
    "export function giveUp(attempts: number) {",
    "  if (attempts > 5) throw new Error(RETRY_CODE);",
    "}",
    "",
  ].join("\n"),
};

let srcDir: string;
let dataDir: string;

beforeAll(async () => {
  await resetData();
  srcDir = await mkdtemp(join(tmpdir(), "tachy-terms-src-"));
  dataDir = await mkdtemp(join(tmpdir(), "tachy-terms-repos-"));
  process.env.TACHY_REPO_DIR = dataDir;
  const git = (args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
      { cwd: srcDir },
    );
  git(["init", "-q", "-b", "master"]);
  for (const [path, body] of Object.entries(FILES)) {
    await mkdir(dirname(join(srcDir, path)), { recursive: true });
    await writeFile(join(srcDir, path), body);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
  await linkRepo({
    slug: REPO,
    url: `file://${srcDir}`,
    defaultBranch: "master",
    sourceSlug: "test-freshdesk",
  });
  await indexRepo(REPO);
}, 300_000);

afterAll(async () => {
  await deleteRepo(REPO).catch(() => {});
  await rm(srcDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.TACHY_REPO_DIR;
  await sql.end();
});

/** Each file's keyword-leg signals for a search with `exactTerms`. */
async function signalsByPath(exactTerms: string[]) {
  const hits = await searchCode("a long ticket about a failing export", {
    repoSlug: REPO,
    exactTerms,
    limit: 20,
  });
  return new Map(
    hits.map((hit) => [
      hit.path,
      { fts: Number(hit.fts_rank ?? 0), trgm: Number(hit.trgm_sim ?? 0) },
    ]),
  );
}

describe("searchCode with exact terms", () => {
  it("matches a quoted message with an 'or' in it as a whole, not word by word", async () => {
    const signals = await signalsByPath(['"No such file or directory"']);
    expect(signals.get("src/open-file.ts")?.fts).toBeGreaterThan(0);
    expect(signals.get("src/paths.ts")?.fts ?? 0).toBe(0);
  });

  it("matches any one of several terms, on the keyword and the fuzzy leg", async () => {
    const signals = await signalsByPath([
      '"No such file or directory"',
      "ERR_RETRY_LIMIT",
    ]);
    for (const path of ["src/open-file.ts", "src/retry.ts"]) {
      expect(signals.get(path)?.fts, path).toBeGreaterThan(0);
      expect(signals.get(path)?.trgm, path).toBeGreaterThan(0);
    }
    expect(signals.get("src/paths.ts")?.fts ?? 0).toBe(0);
  });

  it("keeps the tsvector index for the terms' query", async () => {
    const plan = await sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      return JSON.stringify(
        await tx`
          explain (format json)
          with words as (
            select (select string_agg('(' || t.q::text || ')', ' | ')::tsquery
                    from unnest(${['"No such file or directory"', "ERR_RETRY_LIMIT"]}::text[]) as term,
                         lateral (select plainto_tsquery('simple', tachy_code_words(term)) as q) t
                    where numnode(t.q) > 0) as q
          )
          select c.id from code_blob_chunks c, words w where c.search_tsv @@ w.q
        `,
      );
    });
    expect(plan).toContain("code_blob_chunks_tsv_idx");
  });

  it("searches on when no term leaves a word to match", async () => {
    const signals = await signalsByPath(['"ÄÖÜ"']);
    for (const { fts } of signals.values()) expect(fts).toBe(0);
  });
});
