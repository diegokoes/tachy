// When a release brings host scripts of its own: `host_scripts_differ` in
// deploy/host/common.sh, which tachy-deploy asks before it runs the playbook.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const common = resolve(import.meta.dirname, "../../deploy/host/common.sh");

let checkout: string;
let releaseFile: string;
const commits: Record<string, string> = {};

function git(...args: string[]): string {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function commit(name: string, path: string, text: string): void {
  mkdirSync(dirname(join(checkout, path)), { recursive: true });
  writeFileSync(join(checkout, path), text);
  git("add", "-A");
  git("commit", "-q", "-m", name);
  commits[name] = git("rev-parse", "HEAD");
}

/** Whether a deploy of `target` would run the playbook, given what is installed. */
function differs(installed: string | null, target: string): boolean {
  if (installed === null) rmSync(releaseFile, { force: true });
  else writeFileSync(releaseFile, `${installed}\n`);
  const script = `. "$1"; host_scripts_differ "$2" && echo yes || echo no`;
  const answer = execFileSync("bash", ["-c", script, "bash", common, target], {
    encoding: "utf8",
    env: {
      ...process.env,
      TACHY_DIR: checkout,
      TACHY_ENV_FILE: join(checkout, "no-such-tachy.env"),
      TACHY_HOST_RELEASE_FILE: releaseFile,
    },
  }).trim();
  return answer === "yes";
}

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), "tachy-host-sync-"));
  releaseFile = join(checkout, "host-release");
  git("init", "-q");
  commit("first", "deploy/host/tachy-deploy", "one\n");
  commit("app", "packages/api/src/index.ts", "export {};\n");
  commit("watch", "deploy/watch/tachy-watch", "two\n");
  commit("hazards", "deploy/postgres/schema-hazards.sh", "three\n");
  commit("conf", "deploy/postgres/postgresql.conf", "four\n");
});

afterAll(() => rmSync(checkout, { recursive: true }));

describe("host_scripts_differ", () => {
  it("is false for the release the scripts came from, and for one that changed only the app", () => {
    expect(differs(commits.first, commits.first)).toBe(false);
    expect(differs(commits.first, commits.app)).toBe(false);
  });

  it("is true once a release touches what the playbook installs, in either direction", () => {
    expect(differs(commits.app, commits.watch)).toBe(true);
    expect(differs(commits.watch, commits.app)).toBe(true);
    expect(differs(commits.watch, commits.hazards)).toBe(true);
  });

  it("leaves out what the stack mounts from the checkout by itself", () => {
    expect(differs(commits.hazards, commits.conf)).toBe(false);
  });

  it("is true when the commit the scripts came from is not in the checkout", () => {
    expect(differs("0".repeat(40), commits.conf)).toBe(true);
  });

  it("is false while the host records no release", () => {
    expect(differs(null, commits.conf)).toBe(false);
    expect(differs("", commits.conf)).toBe(false);
  });
});
