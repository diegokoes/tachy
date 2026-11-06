/** The Docker client's failure paths, against a stand-in daemon on a unix socket. */
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerEngine } from "../../packages/sandbox/src/docker";

/** Answers by container id: `gone` 404, `going` 409, anything else 500 in plain text. */
function standInDaemon(socketPath: string): Promise<Server> {
  const daemon = createServer((request, response) => {
    const path = request.url ?? "";
    if (path.includes("/attach")) return response.writeHead(404).end();
    if (path.includes("/wait"))
      return response
        .writeHead(404, { "Content-Type": "application/json" })
        .end(JSON.stringify({ message: "No such container: x" }));
    if (path.includes("/containers/gone")) return response.writeHead(404).end();
    if (path.includes("/containers/going"))
      return response.writeHead(409).end();
    response.writeHead(500).end("the daemon is unwell");
  });
  return new Promise((listening) =>
    daemon.listen(socketPath, () => listening(daemon)),
  );
}

describe("the Docker client", () => {
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "tachy-docker-")),
    "d.sock",
  );
  const docker = new DockerEngine(socketPath);
  let daemon: Server;

  beforeAll(async () => {
    daemon = await standInDaemon(socketPath);
  });

  afterAll(async () => {
    await new Promise((closed) => daemon.close(closed));
  });

  it("refuses an attach the daemon answers without upgrading", async () => {
    await expect(docker.attach("x")).rejects.toThrow(
      "docker attach answered 404",
    );
  });

  it("refuses a wait the daemon will not hold, with its message", async () => {
    await expect(docker.waitForRemoval("x")).rejects.toThrow(
      "docker wait answered 404: No such container: x",
    );
  });

  it("quotes a plain-text answer when a call fails", async () => {
    await expect(docker.start("x")).rejects.toThrow(
      "docker POST /containers/x/start answered 500: the daemon is unwell",
    );
  });

  it("takes a container already gone, or going, as removed", async () => {
    await expect(docker.forceRemove("gone")).resolves.toBeUndefined();
    await expect(docker.forceRemove("going")).resolves.toBeUndefined();
    await expect(docker.forceRemove("broken")).rejects.toThrow("500");
  });
});
