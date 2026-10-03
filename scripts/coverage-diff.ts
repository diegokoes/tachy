/**
 * Fails when too few of the lines a branch adds are run by the suite.
 *
 *   npm run coverage && npx tsx scripts/coverage-diff.ts [base-ref]
 *
 * The thresholds in vitest.config.ts hold what a package already has; this
 * holds new code, which a large package can otherwise absorb without the total
 * moving. Files the coverage report does not measure (components, anything
 * outside packages/<name>/src) are skipped, as they are there.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const MIN_PERCENT = 80;

interface FileCoverage {
  statementMap: Record<string, { start: { line: number } }>;
  s: Record<string, number>;
}

const base =
  process.argv[2] ??
  (process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/dev");

/** Line number to whether a statement starting on it ran, per repo-relative path. */
function measuredLines(): Map<string, Map<number, boolean>> {
  const report: Record<string, FileCoverage> = JSON.parse(
    readFileSync("coverage/coverage-final.json", "utf8"),
  );
  const files = new Map<string, Map<number, boolean>>();
  for (const [path, file] of Object.entries(report)) {
    const lines = new Map<number, boolean>();
    for (const [id, { start }] of Object.entries(file.statementMap)) {
      lines.set(start.line, (lines.get(start.line) ?? false) || file.s[id] > 0);
    }
    files.set(relative(process.cwd(), path), lines);
  }
  return files;
}

function addedLines(): Map<string, number[]> {
  const diff = execFileSync(
    "git",
    [
      "diff",
      "--unified=0",
      "--no-color",
      "--diff-filter=AM",
      `${base}...HEAD`,
      "--",
      "packages",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const files = new Map<string, number[]>();
  let current: number[] | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      current = [];
      files.set(line.slice(6), current);
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !current) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i++) current.push(start + i);
  }
  return files;
}

const measured = measuredLines();
let total = 0;
let covered = 0;
const missed: string[] = [];

for (const [path, lines] of addedLines()) {
  const file = measured.get(path);
  if (!file) continue;
  const unrun: number[] = [];
  for (const line of lines) {
    const ran = file.get(line);
    if (ran === undefined) continue;
    total++;
    if (ran) covered++;
    else unrun.push(line);
  }
  if (unrun.length) missed.push(`  ${path}: ${unrun.join(", ")}`);
}

if (total === 0) {
  console.log(`coverage-diff: no measured lines added since ${base}`);
  process.exit(0);
}

const percent = (100 * covered) / total;
console.log(
  `coverage-diff: ${covered}/${total} added lines run (${percent.toFixed(1)}%), minimum ${MIN_PERCENT}%, base ${base}`,
);
if (missed.length) console.log(`not run:\n${missed.join("\n")}`);
if (percent < MIN_PERCENT) process.exit(1);
