/** The egress proxy over real sockets: a tunnel where allowed, a refusal anywhere else. */
import {
  createServer as createHttpServer,
  request,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseDestinations,
  startEgressProxy,
} from "../../packages/sandbox/src/egress-proxy";

const portOf = (server: { address(): unknown }) =>
  (server.address() as AddressInfo).port;

interface SeenRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

describe("the egress proxy", () => {
  const echo = createServer((socket) => socket.pipe(socket));
  const seen: SeenRequest[] = [];
  const origin = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      seen.push({ ...request, headers: request.headers, body });
      response.writeHead(201, { "x-origin": "yes" }).end("made");
    });
  });
  let proxy: Server;
  let allowedDestination: string;
  let originDestination: string;
  let silentDestination: string;

  beforeAll(async () => {
    await new Promise<void>((listening) =>
      echo.listen(0, "127.0.0.1", listening),
    );
    allowedDestination = `127.0.0.1:${portOf(echo)}`;
    await new Promise<void>((listening) =>
      origin.listen(0, "127.0.0.1", listening),
    );
    originDestination = `127.0.0.1:${portOf(origin)}`;
    const closed = createServer();
    await new Promise<void>((listening) =>
      closed.listen(0, "127.0.0.1", listening),
    );
    silentDestination = `127.0.0.1:${portOf(closed)}`;
    await new Promise((done) => closed.close(done));
    proxy = await startEgressProxy({
      host: "127.0.0.1",
      port: 0,
      allowed: [allowedDestination, originDestination, silentDestination],
    });
  });

  afterAll(async () => {
    await new Promise((closed) => proxy.close(closed));
    await new Promise((closed) => echo.close(closed));
    await new Promise((closed) => origin.close(closed));
  });

  /** A request in absolute form, as a client sends plain HTTP through a proxy. */
  const forward = (
    url: string,
    headers: Record<string, string> = {},
    body = "",
  ) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const asking = request(
          {
            host: "127.0.0.1",
            port: portOf(proxy),
            method: "POST",
            path: url,
            headers,
          },
          (response) => {
            let answer = "";
            response.on(
              "data",
              (chunk: Buffer) => (answer += chunk.toString()),
            );
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: answer,
              }),
            );
          },
        );
        asking.on("error", reject);
        asking.end(body);
      },
    );

  const connectThrough = (destination: string) =>
    new Promise<{ status: number; tunnel: Socket }>((resolve, reject) => {
      const connecting = request({
        host: "127.0.0.1",
        port: portOf(proxy),
        method: "CONNECT",
        path: destination,
      });
      connecting.on("connect", (response, tunnel) =>
        resolve({ status: response.statusCode ?? 0, tunnel }),
      );
      connecting.on("error", reject);
      connecting.end();
    });

  it("tunnels to an allowed destination", async () => {
    const { status, tunnel } = await connectThrough(allowedDestination);
    expect(status).toBe(200);
    const answer = new Promise<string>((resolve) =>
      tunnel.once("data", (chunk) => resolve(chunk.toString())),
    );
    tunnel.write("ping");
    expect(await answer).toBe("ping");
    tunnel.destroy();
  });

  it("refuses every other destination before connecting", async () => {
    for (const destination of [
      "127.0.0.1:1",
      "api.anthropic.com:443",
      `localhost:${portOf(echo)}`,
    ]) {
      const { status, tunnel } = await connectThrough(destination);
      expect(status).toBe(403);
      tunnel.destroy();
    }
  });

  it("passes on bytes sent along with the CONNECT", async () => {
    const socket = connect(portOf(proxy), "127.0.0.1");
    let answer = "";
    socket.on("data", (chunk: Buffer) => (answer += chunk.toString()));
    socket.write(
      `CONNECT ${allowedDestination} HTTP/1.1\r\nHost: ${allowedDestination}\r\n\r\nping`,
    );
    await new Promise<void>((done) => {
      const check = setInterval(() => {
        if (!answer.endsWith("ping")) return;
        clearInterval(check);
        done();
      }, 10);
    });
    expect(answer).toBe("HTTP/1.1 200 Connection Established\r\n\r\nping");
    socket.destroy();
  });

  it("drops the client when an allowed destination does not answer", async () => {
    await expect(connectThrough(silentDestination)).rejects.toThrow();
  });

  it("forwards plain HTTP in absolute form to an allowed destination", async () => {
    const answer = await forward(
      `http://${originDestination}/v1/messages?beta=true`,
      { "x-api-key": "key", "proxy-connection": "keep-alive" },
      "hello",
    );
    expect(answer).toMatchObject({
      status: 201,
      headers: { "x-origin": "yes" },
      body: "made",
    });
    const [received] = seen.splice(0);
    expect(received).toMatchObject({
      method: "POST",
      url: "/v1/messages?beta=true",
      body: "hello",
      headers: { "x-api-key": "key" },
    });
    expect(received!.headers).not.toHaveProperty("proxy-connection");
  });

  it("refuses plain HTTP to anywhere else, port 80 included", async () => {
    for (const url of [
      "http://127.0.0.1:1/",
      `http://localhost:${portOf(origin)}/`,
      "http://api.anthropic.com/v1/messages",
    ])
      expect((await forward(url)).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("drops a forwarded request whose destination does not answer", async () => {
    await expect(forward(`http://${silentDestination}/`)).rejects.toThrow();
  });

  it("answers a plain request with 405", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const asking = request(
        { host: "127.0.0.1", port: portOf(proxy), path: "/" },
        (response) => resolve(response.statusCode ?? 0),
      );
      asking.on("error", reject);
      asking.end();
    });
    expect(status).toBe(405);
    expect((await forward(`https://${originDestination}/`)).status).toBe(405);
  });

  it("reads its list from a comma-separated variable", () => {
    expect(
      parseDestinations(" Api.Anthropic.com:443, example.com:443,,"),
    ).toEqual(["api.anthropic.com:443", "example.com:443"]);
  });
});
