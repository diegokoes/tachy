/**
 * Fails when too few of the lines a branch changes are run by the suite.
 *
 *   npm run coverage && npx tsx scripts/coverage-diff.ts [base-ref]
 *
 * The thresholds in vitest.config.ts hold what a package already has; this
 * holds new code, which a large package can otherwise absorb without the total
 * moving. Files the coverage report does not measure (components, anything
 * outside packages/<name>/src) are skipped, as they are there. A changed line
 * that holds the code its base had, with locals renamed or the layout changed,
 * counts as run whether or not a test reaches it: `renamed-lines.ts` proves
 * which those are.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseHunks, renamedLines, type Hunk } from "./renamed-lines";

const MIN_PERCENT = 80;
const SCRIPT_RE = /\.[cm]?[jt]s$/;

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

const git = (args: string[], stderr: "inherit" | "ignore" = "inherit") =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", stderr],
  });

function changedHunks(): Map<string, Hunk[]> {
  return parseHunks(
    git([
      "diff",
      "--unified=0",
      "--no-color",
      "--diff-filter=AM",
      `${base}...HEAD`,
      "--",
      "packages",
    ]),
  );
}

/**
 * The changed lines of `path` that hold its base's code. None for a file the
 * base does not have, where `git show` fails.
 */
function sameCodeLines(
  path: string,
  hunks: Hunk[],
  mergeBase: string,
): Set<number> {
  if (!SCRIPT_RE.test(path)) return new Set();
  try {
    return renamedLines(
      path,
      git(["show", `${mergeBase}:${path}`], "ignore"),
      git(["show", `HEAD:${path}`], "ignore"),
      hunks,
    );
  } catch {
    return new Set();
  }
}

const measured = measuredLines();
const mergeBase = git(["merge-base", base, "HEAD"]).trim();
let total = 0;
let covered = 0;
let sameCodeTotal = 0;
const missed: string[] = [];

for (const [path, hunks] of changedHunks()) {
  const file = measured.get(path);
  if (!file) continue;
  const sameCode = sameCodeLines(path, hunks, mergeBase);
  const unrun: number[] = [];
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.headCount; i++) {
      const line = hunk.headStart + i;
      const ran = file.get(line);
      if (ran === undefined) continue;
      total++;
      if (sameCode.has(line)) sameCodeTotal++;
      if (ran || sameCode.has(line)) covered++;
      else unrun.push(line);
    }
  }
  if (unrun.length) missed.push(`  ${path}: ${unrun.join(", ")}`);
}

if (total === 0) {
  console.log(`coverage-diff: no measured lines changed since ${base}`);
  process.exit(0);
}

const percent = (100 * covered) / total;
console.log(
  `coverage-diff: ${covered}/${total} changed lines run (${percent.toFixed(1)}%), minimum ${MIN_PERCENT}%, base ${base}`,
);
if (sameCodeTotal)
  console.log(
    `${sameCodeTotal} of them hold their base's code and count as run`,
  );
if (missed.length) console.log(`not run:\n${missed.join("\n")}`);
if (percent < MIN_PERCENT) process.exit(1);
