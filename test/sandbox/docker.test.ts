/** The Docker client's failure paths, against a stand-in daemon on a unix socket. */
import { mkdtempSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerEngine } from "../../packages/sandbox/src/docker";

/** The pulls the stand-in was asked for, as `fromImage` and `tag`. */
const pulls: { fromImage: string | null; tag: string | null }[] = [];

/** How the stand-in answers a pull, by the image name asked for. */
function answerPull(fromImage: string, response: ServerResponse): void {
  if (fromImage.endsWith("refused"))
    return void response
      .writeHead(404, { "Content-Type": "application/json" })
      .end(JSON.stringify({ message: "pull access denied" }));
  const progress = [JSON.stringify({ status: "Pulling from x" }), "not json"];
  if (fromImage.endsWith("broken"))
    progress.push(JSON.stringify({ error: "unexpected EOF" }));
  response.writeHead(200).end(progress.join("\n"));
}

/**
 * Images: `present` is there, any other name is pulled. Containers by id:
 * `gone` 404, `going` 409, anything else 500 in plain text.
 */
function standInDaemon(socketPath: string): Promise<Server> {
  const daemon = createServer((request, response) => {
    const path = request.url ?? "";
    if (path.endsWith("/info"))
      return response
        .writeHead(200)
        .end(JSON.stringify({ Runtimes: { runc: {}, runsc: {} } }));
    if (path.includes("/images/create")) {
      const query = new URL(path, "http://daemon").searchParams;
      pulls.push({ fromImage: query.get("fromImage"), tag: query.get("tag") });
      return answerPull(query.get("fromImage") ?? "", response);
    }
    if (path.includes("/images/"))
      return path.includes("/images/present")
        ? response.writeHead(200).end(JSON.stringify({ Id: "sha256:present" }))
        : response.writeHead(404).end();
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

  it("pulls an image only when the daemon lacks it", async () => {
    pulls.length = 0;
    await docker.ensureImage("present:1");
    expect(pulls).toEqual([]);
    await docker.ensureImage("registry.local:5000/team/sandbox:sha-1");
    await docker.ensureImage("ghcr.io/team/sandbox@sha256:abc");
    await docker.ensureImage("sandbox");
    expect(pulls).toEqual([
      { fromImage: "registry.local:5000/team/sandbox", tag: "sha-1" },
      { fromImage: "ghcr.io/team/sandbox", tag: "sha256:abc" },
      { fromImage: "sandbox", tag: "latest" },
    ]);
  });

  it("fails a pull the daemon refuses, or one whose progress ends in an error", async () => {
    await expect(docker.ensureImage("refused:1")).rejects.toThrow(
      "docker pull refused:1 answered 404: pull access denied",
    );
    await expect(docker.ensureImage("broken:1")).rejects.toThrow(
      "docker pull broken:1 failed: unexpected EOF",
    );
  });

  it("lists the runtimes the daemon was configured with", async () => {
    expect(await docker.runtimes()).toEqual(["runc", "runsc"]);
  });

  it("takes a container already gone, or going, as removed", async () => {
    await expect(docker.forceRemove("gone")).resolves.toBeUndefined();
    await expect(docker.forceRemove("going")).resolves.toBeUndefined();
    await expect(docker.forceRemove("broken")).rejects.toThrow("500");
  });
});
