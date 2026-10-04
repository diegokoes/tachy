import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillCodeWords,
  chunkCode,
  chunkSymbols,
  definedSymbols,
  deleteRepo,
  fileStem,
  indexRepo,
  linkRepo,
  searchCode,
} from "@tachy/core/code";
import { sql } from "../database";

afterAll(() => sql.end());

describe("the names a chunk defines", () => {
  it("finds declarations across languages, and not locals", () => {
    const names = definedSymbols(
      [
        "export async function scheduleDueRuns(now = new Date()) {",
        "    const inserted = 0;",
        "}",
        "export const WORD_SIM_THRESHOLD = 0.35;",
        "class LabelQueue {}",
        "interface RunInput {}",
        "type Kind = 'a' | 'b';",
        "def resolve_buffer(size):",
        "func (s *Server) Start() {}",
        "create table job_runs (id uuid);",
        "CREATE OR REPLACE FUNCTION tachy_join(arr text[]) returns text",
      ].join("\n"),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "scheduleDueRuns",
        "WORD_SIM_THRESHOLD",
        "LabelQueue",
        "RunInput",
        "Kind",
        "resolve_buffer",
        "job_runs",
        "tachy_join",
      ]),
    );
    expect(names).not.toContain("inserted");
  });

  it("names a file's first chunk after the file", () => {
    expect(fileStem("packages/web/src/flows/FlowCanvas.svelte")).toBe(
      "FlowCanvas",
    );
    expect(fileStem("test/jobs/jobs.test.ts")).toBe("jobs");
    expect(fileStem("Dockerfile")).toBe("Dockerfile");
    expect(fileStem(".gitignore")).toBe(".gitignore");

    const text = "<script>let open = $state(false);</script>";
    expect(chunkSymbols("src/SetupWizard.svelte", { ordinal: 0, text })).toBe(
      "SetupWizard",
    );
    expect(chunkSymbols("src/SetupWizard.svelte", { ordinal: 1, text })).toBe(
      "",
    );
  });
});

describe("chunk size", () => {
  it("cuts to the budget it is given", () => {
    const content = Array.from(
      { length: 120 },
      (_, i) => `const value${i} = ${"x".repeat(30)};`,
    ).join("\n");
    const wide = chunkCode(content);
    const narrow = chunkCode(content, 1000);
    expect(Math.max(...wide.map((c) => c.text.length))).toBeLessThanOrEqual(
      2400,
    );
    expect(Math.max(...narrow.map((c) => c.text.length))).toBeLessThanOrEqual(
      1000,
    );
    expect(narrow.length).toBeGreaterThan(wide.length);
    // Every line is still in some chunk.
    expect(narrow.at(-1)!.endLine).toBe(120);
  });
});

describe("identifiers as words", () => {
  it("splits camelCase, acronyms, snake_case and paths", async () => {
    const [row] = await sql`
      select tachy_code_words('scheduleDueRuns WORD_SIM_THRESHOLD HTTPServer src/search/rank.ts') as words
    `;
    expect(row.words).toBe(
      "schedule Due Runs WORD SIM THRESHOLD HTTP Server src search rank ts",
    );
  });
});

describe("code search by name", () => {
  let srcDir: string;
  let dataDir: string;

  const uses = Array.from(
    { length: 8 },
    (_, i) => `  expect(await scheduleDueRuns(now${i})).toBe(${i});`,
  ).join("\n");
  const notes = Array.from(
    { length: 300 },
    (_, i) =>
      `Line ${i}: the scheduler calls scheduleDueRuns every thirty seconds, and scheduleDueRuns takes a lock.`,
  ).join("\n");

  beforeAll(async () => {
    srcDir = await mkdtemp(join(tmpdir(), "tachy-search-src-"));
    dataDir = await mkdtemp(join(tmpdir(), "tachy-search-repos-"));
    process.env.TACHY_REPO_DIR = dataDir;
    const git = (args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
        { cwd: srcDir },
      );
    git(["init", "-q", "-b", "main"]);
    git(["config", "uploadpack.allowFilter", "true"]);
    git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
    const files: Record<string, string> = {
      "scheduler.ts":
        "/** Inserts the runs that are due. */\nexport async function scheduleDueRuns(now = new Date()): Promise<number> {\n  return 0;\n}\n",
      "scheduler.test.ts": `import { scheduleDueRuns } from "./scheduler";\nit("fires", async () => {\n${uses}\n});\n`,
      "settings.ts": "export const WORD_SIM_THRESHOLD = 0.35;\n",
      "SetupWizard.svelte":
        "<script>\n  let step = $state(0);\n</script>\n<p>Welcome. Name your organisation to begin.</p>\n",
      "notes.md": notes,
    };
    for (const [path, body] of Object.entries(files))
      await writeFile(join(srcDir, path), body);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "init"]);

    await linkRepo({
      slug: "searchrepo",
      url: `file://${srcDir}`,
      defaultBranch: "main",
    });
    await indexRepo("searchrepo");
  }, 120_000);

  afterAll(async () => {
    await deleteRepo("searchrepo").catch(() => {});
    await rm(srcDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.TACHY_REPO_DIR;
  });

  const paths = async (query: string) =>
    (await searchCode(query, { repoSlug: "searchrepo" })).map((h) => h.path);

  it("puts the definition before the files that use the name", async () => {
    expect((await paths("scheduleDueRuns"))[0]).toBe("scheduler.ts");
  });

  it("finds a symbol typed as words, in either casing", async () => {
    expect((await paths("schedule due runs"))[0]).toBe("scheduler.ts");
    expect((await paths("word sim threshold"))[0]).toBe("settings.ts");
  });

  it("finds a file by its name, which its text never says", async () => {
    expect(await paths("setup wizard")).toContain("SetupWizard.svelte");
    expect((await paths("SetupWizard"))[0]).toBe("SetupWizard.svelte");
  });

  it("lets one file take at most two places on a page", async () => {
    const found = await paths("scheduleDueRuns");
    expect(found.filter((p) => p === "notes.md").length).toBeLessThanOrEqual(2);
    expect(found).toContain("scheduler.test.ts");
  });

  it("gives chunks indexed before the lexical leg their words on the next index", async () => {
    const [repo] = await sql`select id from repos where slug = 'searchrepo'`;
    const [{ n }] = await sql`
      select count(*)::int as n from code_blob_chunks where repo_id = ${repo.id}
    `;
    await sql`update code_blob_chunks set search_tsv = null where repo_id = ${repo.id}`;
    // Without its words the definition has only the vector leg to arrive by.
    const before = await searchCode("schedule due runs", {
      repoSlug: "searchrepo",
    });
    expect(before.every((h) => Number(h.fts_rank) === 0)).toBe(true);

    expect(await backfillCodeWords(repo.id)).toBe(n);
    expect(await backfillCodeWords(repo.id)).toBe(0);
    expect((await paths("schedule due runs"))[0]).toBe("scheduler.ts");
  });

  it("returns nothing for words no file holds", async () => {
    expect(await paths("zzzzqqqq")).toEqual([]);
  });
});
