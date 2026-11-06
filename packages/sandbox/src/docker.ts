/** The Docker Engine API calls the launcher makes, over the daemon's unix socket. */
import { request, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ContainerSpec } from "./container-spec";

/** Volume sub-paths need API 1.45, Docker Engine 26. */
const API_PREFIX = "/v1.45";

const isSuccess = (status: number) => status >= 200 && status < 300;

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString()));
    response.on("error", reject);
  });
}

function dockerMessage(body: string): string {
  try {
    return (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    return body;
  }
}

/** An image reference as the pull API takes it: the name, and a tag or digest. */
function splitReference(image: string): { name: string; tag: string } {
  const digestAt = image.indexOf("@");
  if (digestAt >= 0)
    return { name: image.slice(0, digestAt), tag: image.slice(digestAt + 1) };
  const tagAt = image.lastIndexOf(":");
  if (tagAt > image.lastIndexOf("/"))
    return { name: image.slice(0, tagAt), tag: image.slice(tagAt + 1) };
  return { name: image, tag: "latest" };
}

/** A pull can answer 200 and still fail: its progress stream ends in an error line. */
function pullFailure(body: string): string | undefined {
  for (const line of body.split("\n").filter(Boolean)) {
    try {
      const progress = JSON.parse(line) as { error?: string };
      if (progress.error) return progress.error;
    } catch {
      continue;
    }
  }
  return undefined;
}

export class DockerEngine {
  constructor(private readonly socketPath: string) {}

  async createContainer(spec: ContainerSpec): Promise<string> {
    const created = await this.call("POST", "/containers/create", spec);
    return created.Id as string;
  }

  /** stdin, and stdout and stderr in Docker's framing. Ending the write side closes stdin. */
  attach(id: string): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      const attaching = request({
        socketPath: this.socketPath,
        method: "POST",
        path: `${API_PREFIX}/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
        headers: { Connection: "Upgrade", Upgrade: "tcp" },
      });
      attaching.on("upgrade", (_response, socket, head) => {
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      attaching.on("response", (response) =>
        reject(new Error(`docker attach answered ${response.statusCode}`)),
      );
      attaching.on("error", reject);
      attaching.end();
    });
  }

  async start(id: string): Promise<void> {
    await this.call("POST", `/containers/${id}/start`);
  }

  /**
   * Settles once the daemon holds the wait, which it answers with headers
   * first: a container started after that cannot exit unseen. The exit code
   * follows when the container is removed.
   */
  waitForRemoval(id: string): Promise<{ exitCode: Promise<number> }> {
    return new Promise((registered, failed) => {
      const waiting = request(
        {
          socketPath: this.socketPath,
          method: "POST",
          path: `${API_PREFIX}/containers/${id}/wait?condition=removed`,
        },
        async (response) => {
          const status = response.statusCode ?? 0;
          if (!isSuccess(status))
            return failed(
              new Error(
                `docker wait answered ${status}: ${dockerMessage(await readBody(response))}`,
              ),
            );
          const exitCode = readBody(response).then(
            (body) => (JSON.parse(body) as { StatusCode: number }).StatusCode,
          );
          registered({ exitCode });
        },
      );
      waiting.on("error", failed);
      waiting.end();
    });
  }

  /** Kills and removes. A container already gone or going is no error. */
  async forceRemove(id: string): Promise<void> {
    await this.call(
      "DELETE",
      `/containers/${id}?force=1`,
      undefined,
      [404, 409],
    );
  }

  /** Pulls `image` unless the daemon has it. The daemon fetches; the caller needs no network. */
  async ensureImage(image: string): Promise<void> {
    const inspected = await this.call(
      "GET",
      `/images/${image}/json`,
      undefined,
      [404],
    );
    if (inspected.Id) return;
    const { name, tag } = splitReference(image);
    const query = new URLSearchParams({ fromImage: name, tag });
    await new Promise<void>((resolve, reject) => {
      const pulling = request(
        {
          socketPath: this.socketPath,
          method: "POST",
          path: `${API_PREFIX}/images/create?${query}`,
        },
        async (response) => {
          const status = response.statusCode ?? 0;
          const body = await readBody(response);
          if (!isSuccess(status))
            return reject(
              new Error(
                `docker pull ${image} answered ${status}: ${dockerMessage(body)}`,
              ),
            );
          const failure = pullFailure(body);
          if (failure)
            return reject(new Error(`docker pull ${image} failed: ${failure}`));
          resolve();
        },
      );
      pulling.on("error", reject);
      pulling.end();
    });
  }

  async listLabelled(label: string): Promise<string[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    const containers = await this.call(
      "GET",
      `/containers/json?all=1&filters=${filters}`,
    );
    return (containers as { Id: string }[]).map((container) => container.Id);
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
    toleratedStatuses: number[] = [],
  ): Promise<any> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const calling = request(
        {
          socketPath: this.socketPath,
          method,
          path: API_PREFIX + path,
          headers: payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {},
        },
        async (response) => {
          const status = response.statusCode ?? 0;
          const text = await readBody(response);
          if (isSuccess(status)) return resolve(text ? JSON.parse(text) : {});
          if (toleratedStatuses.includes(status)) return resolve({});
          reject(
            new Error(
              `docker ${method} ${path.split("?")[0]} answered ${status}: ${dockerMessage(text)}`,
            ),
          );
        },
      );
      calling.on("error", reject);
      calling.end(payload);
    });
  }
}
