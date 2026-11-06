/**
 * The one holder of the Docker socket. For each connection on its own unix
 * socket it starts one locked-down container, streams the container's stdin
 * and output, and removes it when it exits or the connection closes.
 */
import { chmodSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  claudeSandboxSpec,
  SANDBOX_LABEL,
  toolsSandboxSpec,
  type ClaudeSandboxSettings,
  type ContainerSpec,
  type ToolsSandboxSettings,
} from "./container-spec";
import { DockerEngine } from "./docker";
import { logEvent } from "./log";
import {
  exitFrame,
  FrameReader,
  parseSandboxRequest,
  STREAM,
  type SandboxRequest,
} from "./protocol";

export interface LauncherSettings extends ClaudeSandboxSettings {
  socketPath: string;
  dockerSocket: string;
  maxSandboxes: number;
  /** Absent, the launcher starts no tools sandbox. */
  tools?: ToolsSandboxSettings;
}

export interface Launcher {
  readonly running: number;
  close(): Promise<void>;
}

/** The api and the workers reach the socket through the group they share with the launcher. */
const SOCKET_MODE = 0o660;
const MAX_REQUEST_BYTES = 1024 * 1024;
const SHORT_ID_CHARS = 12;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads the request line and leaves whatever stdin followed it unread. Null
 * when the connection closed without sending a byte, as a health probe does.
 */
function readRequest(client: Socket): Promise<SandboxRequest | null> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const settle = (outcome: () => SandboxRequest | null, rest?: Buffer) => {
      client.pause();
      client.off("data", onData);
      client.off("close", onClose);
      if (rest?.length) client.unshift(rest);
      try {
        resolve(outcome());
      } catch (error) {
        reject(error);
      }
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf("\n");
      if (newline >= 0)
        return settle(
          () => parseSandboxRequest(buffered.subarray(0, newline).toString()),
          buffered.subarray(newline + 1),
        );
      if (buffered.length > MAX_REQUEST_BYTES)
        settle(() => {
          throw new Error("the request line is too long");
        });
    };
    const onClose = () =>
      settle(() => {
        if (!buffered.length) return null;
        throw new Error("the connection closed before its request");
      });
    client.on("data", onData);
    client.on("close", onClose);
  });
}

/** Once all the container's output is read, or its client is gone and nobody reads it. */
function drained(containerIo: Duplex, client: Socket): Promise<void> {
  return new Promise((done) => {
    if (client.destroyed) return done();
    containerIo.once("end", () => done());
    containerIo.once("close", () => done());
    client.once("close", () => done());
  });
}

function specFor(
  request: SandboxRequest,
  settings: LauncherSettings,
): ContainerSpec {
  if (request.kind === "claude") return claudeSandboxSpec(request, settings);
  if (!settings.tools) throw new Error("this launcher starts no tools sandbox");
  return toolsSandboxSpec(request, settings.instance, settings.tools);
}

async function removeLeftovers(
  docker: DockerEngine,
  instance: string,
): Promise<void> {
  const leftovers = await docker.listLabelled(`${SANDBOX_LABEL}=${instance}`);
  await Promise.all(leftovers.map((id) => docker.forceRemove(id)));
  if (leftovers.length)
    logEvent("warn", "sandbox_leftovers_removed", { count: leftovers.length });
}

export async function startLauncher(
  settings: LauncherSettings,
): Promise<Launcher> {
  const docker = new DockerEngine(settings.dockerSocket);
  await removeLeftovers(docker, settings.instance);
  let admitted = 0;
  const clients = new Set<Socket>();
  const serving = new Set<Promise<void>>();

  async function serve(client: Socket): Promise<void> {
    client.on("error", () => {});
    let containerId: string | undefined;
    let isAdmitted = false;
    try {
      const request = await readRequest(client);
      if (!request) return;
      if (admitted >= settings.maxSandboxes)
        throw new Error("the sandbox limit is reached");
      admitted++;
      isAdmitted = true;
      const id = await docker.createContainer(specFor(request, settings));
      containerId = id;
      const removeOnHangUp = () => void docker.forceRemove(id).catch(() => {});
      client.once("close", removeOnHangUp);
      if (client.destroyed) removeOnHangUp();

      const containerIo = await docker.attach(id);
      containerIo.on("error", () => {});
      const outputDrained = drained(containerIo, client);
      const { exitCode } = await docker.waitForRemoval(id);
      await docker.start(id);
      logEvent("info", "sandbox_started", {
        container: id.slice(0, SHORT_ID_CHARS),
        kind: request.kind,
      });
      const fromClient = new FrameReader();
      client.on("data", (chunk: Buffer) => {
        for (const frame of fromClient.read(chunk))
          if (frame.stream === STREAM.stdin) containerIo.write(frame.payload);
          else if (frame.stream === STREAM.stdinEnd) containerIo.end();
      });
      client.resume();
      containerIo.pipe(client, { end: false });

      const code = await exitCode;
      await outputDrained;
      containerIo.destroy();
      client.off("close", removeOnHangUp);
      client.end(exitFrame({ exitCode: code }));
      logEvent("info", "sandbox_exited", {
        container: id.slice(0, SHORT_ID_CHARS),
        kind: request.kind,
        exitCode: code,
      });
    } catch (error) {
      logEvent("warn", "sandbox_failed", {
        ...(containerId
          ? { container: containerId.slice(0, SHORT_ID_CHARS) }
          : {}),
        error: messageOf(error),
      });
      if (containerId) await docker.forceRemove(containerId).catch(() => {});
      if (!client.destroyed)
        client.end(exitFrame({ exitCode: null, error: messageOf(error) }));
    } finally {
      if (isAdmitted) admitted--;
      // Reads the client's close, which a refusal left unread, so its socket ends.
      client.resume();
    }
  }

  const server = createServer((client) => {
    clients.add(client);
    client.once("close", () => clients.delete(client));
    const done: Promise<void> = serve(client).finally(() =>
      serving.delete(done),
    );
    serving.add(done);
  });
  rmSync(settings.socketPath, { force: true });
  await new Promise<void>((listening) =>
    server.listen(settings.socketPath, listening),
  );
  chmodSync(settings.socketPath, SOCKET_MODE);
  logEvent("info", "sandbox_launcher_ready", {
    image: settings.image,
    network: settings.network,
  });

  return {
    get running() {
      return admitted;
    },
    async close() {
      const closed = new Promise((done) => server.close(done));
      for (const client of clients) client.destroy();
      await closed;
      await Promise.allSettled([...serving]);
    },
  };
}
