import { describe, expect, it } from "vitest";
import {
  claudeSandboxSpec,
  SANDBOX_LABEL,
  toolsSandboxSpec,
  type ClaudeSandboxSettings,
  type ToolsSandboxSettings,
} from "../../packages/sandbox/src/container-spec";

const SETTINGS: ClaudeSandboxSettings = {
  instance: "tachy",
  image: "ghcr.io/example/claude-sandbox@sha256:abc",
  network: "tachy_sandbox",
  stateVolume: "tachy_tachy-agent-home",
  proxyUrl: "http://egress:3128",
  memoryMb: 512,
  pidsLimit: 128,
  cpus: 1.5,
};
const PERSON = "0b6f7c3e-5d1a-4f2b-9e8c-7a6d5c4b3a21";

const specFor = (request: Partial<Parameters<typeof claudeSandboxSpec>[0]>) =>
  claudeSandboxSpec(
    { kind: "claude", args: [], env: {}, ...request },
    SETTINGS,
  );

describe("the claude sandbox container", () => {
  it("runs the deployment's image, locked down, on the sandbox network", () => {
    const spec = specFor({ args: ["--print"] });
    expect(spec).toMatchObject({
      Image: SETTINGS.image,
      Cmd: ["--print"],
      User: "1000:1000",
      WorkingDir: "/app",
      Labels: { [SANDBOX_LABEL]: "tachy" },
      Tty: false,
      HostConfig: {
        AutoRemove: true,
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 128,
        Memory: 512 * 1024 * 1024,
        MemorySwap: 512 * 1024 * 1024,
        NanoCpus: 1_500_000_000,
        IpcMode: "private",
        NetworkMode: "tachy_sandbox",
        LogConfig: { Type: "none" },
      },
    });
    expect(Object.keys(spec.HostConfig.Tmpfs).sort()).toEqual([
      "/home/claude",
      "/tmp",
    ]);
  });

  it("mounts only the named person's state, and none for a one-shot", () => {
    expect(specFor({ state: `users/${PERSON}` }).HostConfig.Mounts).toEqual([
      {
        Type: "volume",
        Source: SETTINGS.stateVolume,
        Target: "/home/claude/.claude",
        VolumeOptions: { Subpath: `users/${PERSON}` },
      },
    ]);
    expect(specFor({}).HostConfig.Mounts).toEqual([]);
  });

  it("refuses any other state folder", () => {
    for (const state of ["users/../..", "../users/x", "users/x", "/etc", ""])
      expect(() => specFor({ state })).toThrow(/state folder/);
  });

  it("keeps only the env names a request may set, and fixes the rest", () => {
    const { Env } = specFor({
      env: {
        ANTHROPIC_API_KEY: "sk-test",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        PATH: "/nowhere",
        HOME: "/root",
        DATABASE_URL: "postgres://secret",
        HTTPS_PROXY: "http://elsewhere:3128",
      },
    });
    expect(Env.sort()).toEqual([
      "ANTHROPIC_API_KEY=sk-test",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
      "CLAUDE_CODE_ENTRYPOINT=sdk-ts",
      "CLAUDE_CONFIG_DIR=/home/claude/.claude",
      "HOME=/home/claude",
      "HTTPS_PROXY=http://egress:3128",
    ]);
  });

  it("refuses too many args, an oversized one, or a NUL", () => {
    expect(() => specFor({ args: Array(65).fill("--x") })).toThrow();
    expect(() => specFor({ args: ["x".repeat(65 * 1024)] })).toThrow();
    expect(() => specFor({ args: ["a\0b"] })).toThrow();
  });
});

describe("the tools sandbox container", () => {
  const TOOLS: ToolsSandboxSettings = {
    image: "ghcr.io/example/tachy@sha256:def",
    network: "tachy",
    repoVolume: "tachy_tachy-repo-data",
    memoryMb: 512,
    pidsLimit: 256,
    cpus: 1,
  };
  const toolsSpecFor = (
    request: Partial<Parameters<typeof toolsSandboxSpec>[0]>,
  ) =>
    toolsSandboxSpec(
      { kind: "tools", args: [], env: {}, ...request },
      { instance: "tachy" },
      TOOLS,
    );

  it("runs tachy's tools server, locked down, on the database's network", () => {
    expect(toolsSpecFor({})).toMatchObject({
      Image: TOOLS.image,
      Cmd: ["node", "dist/mcp.js"],
      User: "1000:1000",
      Healthcheck: { Test: ["NONE"] },
      WorkingDir: "/app",
      Labels: { [SANDBOX_LABEL]: "tachy" },
      HostConfig: {
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        NetworkMode: "tachy",
        Tmpfs: { "/tmp": "size=256m" },
        Mounts: [
          {
            Type: "volume",
            Source: "tachy_tachy-repo-data",
            Target: "/app/data",
          },
        ],
        LogConfig: { Type: "none" },
      },
    });
  });

  it("takes neither arguments nor a person's state", () => {
    expect(() => toolsSpecFor({ args: ["-e", "1"] })).toThrow(/no arguments/);
    expect(() => toolsSpecFor({ state: "users/_default" })).toThrow(
      /no arguments and no state/,
    );
  });

  it("keeps the tools' own env and source tokens, and fixes the rest", () => {
    const { Env } = toolsSpecFor({
      env: {
        DATABASE_URL: "postgres://tachy_mcp@postgres/tachy",
        TACHY_INTERNAL_SECRET: "s",
        TACHY_MCP_SERVER_TOKENS: "{}",
        GITHUB_TOKEN_MAIN: "ghp_x",
        AZURE_DEVOPS_TOKEN_TEAM_A: "pat",
        NODE_OPTIONS: "--require /tmp/x.js",
        LD_PRELOAD: "/tmp/x.so",
        PATH: "/tmp",
        TACHY_REPO_DIR: "/elsewhere",
        GIT_SSH_COMMAND: "sh",
        TACHY_SECRET_KEY: "vault",
        TACHY_USER_EMAIL: "a\0b",
      },
    });
    expect(Env.sort()).toEqual([
      "AZURE_DEVOPS_TOKEN_TEAM_A=pat",
      "DATABASE_URL=postgres://tachy_mcp@postgres/tachy",
      "GITHUB_TOKEN_MAIN=ghp_x",
      "NODE_OPTIONS=--max-old-space-size=256",
      "TACHY_INTERNAL_SECRET=s",
      "TACHY_MCP_SERVER_TOKENS={}",
      "TACHY_REPO_DIR=/app/data/repos",
    ]);
  });
});

describe("a sandbox's runtime", () => {
  const request = { kind: "claude" as const, args: [], env: {} };

  it("is Docker's default unless the deployment names one", () => {
    expect(claudeSandboxSpec(request, SETTINGS).HostConfig).not.toHaveProperty(
      "Runtime",
    );
    expect(
      claudeSandboxSpec(request, { ...SETTINGS, runtime: "runsc" }).HostConfig
        .Runtime,
    ).toBe("runsc");
    expect(
      toolsSandboxSpec(
        { kind: "tools", args: [], env: {} },
        { instance: "tachy", runtime: "runsc" },
        {
          image: "tachy",
          network: "tachy",
          repoVolume: "repos",
          memoryMb: 512,
          pidsLimit: 256,
          cpus: 1,
        },
      ).HostConfig.Runtime,
    ).toBe("runsc");
  });
});
