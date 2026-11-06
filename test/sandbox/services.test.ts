/** The launcher and the egress proxy as services: settings from the environment, start and stop. */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  egressSettingsFromEnv,
  LAUNCHER_SOCKET,
  launcherSettingsFromEnv,
} from "../../packages/sandbox/src/services";

const REQUIRED = {
  TACHY_SANDBOX_IMAGE: "ghcr.io/team/tachy:sandbox-sha-1",
  TACHY_SANDBOX_NETWORK: "tachy-sandbox",
  TACHY_SANDBOX_STATE_VOLUME: "tachy_tachy-agent-home",
};

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((listening) => probe.listen(0, listening));
  const { port } = probe.address() as AddressInfo;
  await new Promise((closed) => probe.close(closed));
  return port;
}

/**
 * Imports a service entry point, then calls the SIGTERM handler it added, with
 * process.exit stubbed: what Docker does when it stops the container.
 */
async function startAndStop(entryPoint: string): Promise<void> {
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
  const before = process.listeners("SIGTERM");
  await import(entryPoint);
  const stop = process
    .listeners("SIGTERM")
    .find((listener) => !before.includes(listener));
  expect(stop).toBeDefined();
  process.removeListener("SIGTERM", stop!);
  stop!("SIGTERM");
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
}

describe("the launcher's settings", () => {
  it("takes the deployment's names and fills the rest with defaults", () => {
    expect(launcherSettingsFromEnv(REQUIRED)).toEqual({
      instance: "tachy",
      image: REQUIRED.TACHY_SANDBOX_IMAGE,
      network: REQUIRED.TACHY_SANDBOX_NETWORK,
      stateVolume: REQUIRED.TACHY_SANDBOX_STATE_VOLUME,
      proxyUrl: "http://egress:3128",
      memoryMb: 512,
      pidsLimit: 256,
      cpus: 1,
      socketPath: LAUNCHER_SOCKET,
      dockerSocket: "/var/run/docker.sock",
      maxSandboxes: 20,
    });
  });

  it("refuses to start without an image, a network or a state volume", () => {
    for (const name of Object.keys(REQUIRED))
      expect(() =>
        launcherSettingsFromEnv({ ...REQUIRED, [name]: " " }),
      ).toThrow(`${name} is not set`);
  });

  it("reads each limit as a positive number", () => {
    expect(
      launcherSettingsFromEnv({
        ...REQUIRED,
        TACHY_SANDBOX_CPUS: "0.5",
        TACHY_SANDBOX_MEMORY_MB: "768",
      }),
    ).toMatchObject({ cpus: 0.5, memoryMb: 768 });
    expect(() =>
      launcherSettingsFromEnv({ ...REQUIRED, TACHY_SANDBOX_MAX: "0" }),
    ).toThrow("TACHY_SANDBOX_MAX must be a positive number, not '0'");
    expect(() =>
      launcherSettingsFromEnv({ ...REQUIRED, TACHY_SANDBOX_PIDS: "many" }),
    ).toThrow("TACHY_SANDBOX_PIDS must be a positive number, not 'many'");
  });
});

describe("the egress proxy's settings", () => {
  it("allows only api.anthropic.com:443 unless the deployment lists more", () => {
    expect(egressSettingsFromEnv({})).toEqual({
      host: "0.0.0.0",
      port: 3128,
      allowed: ["api.anthropic.com:443"],
    });
    expect(
      egressSettingsFromEnv({
        TACHY_SANDBOX_EGRESS: "api.anthropic.com:443, mock-llm:4010",
        TACHY_EGRESS_PORT: "3129",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 3129,
      allowed: ["api.anthropic.com:443", "mock-llm:4010"],
    });
  });
});

describe("the service entry points", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("start the egress proxy from the environment, and stop it on SIGTERM", async () => {
    vi.stubEnv("TACHY_EGRESS_PORT", String(await freePort()));
    await startAndStop("../../packages/sandbox/src/egress-service");
  });

  it("start the launcher from the environment, and stop it on SIGTERM", async () => {
    const socketDir = mkdtempSync(join(tmpdir(), "tachy-service-"));
    for (const [name, value] of Object.entries({
      ...REQUIRED,
      TACHY_SANDBOX_IMAGE: "node:26.13.0-slim",
      TACHY_SANDBOX_INSTANCE: `tachy-test-${randomUUID().slice(0, 8)}`,
      TACHY_SANDBOX_SOCKET: join(socketDir, "launcher.sock"),
    }))
      vi.stubEnv(name, value);
    await startAndStop("../../packages/sandbox/src/launcher-service");
  });
});
