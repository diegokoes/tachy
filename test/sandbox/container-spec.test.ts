import { describe, expect, it } from "vitest";
import {
  claudeSandboxSpec,
  SANDBOX_LABEL,
  type SandboxSettings,
} from "../../packages/sandbox/src/container-spec";

const SETTINGS: SandboxSettings = {
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
