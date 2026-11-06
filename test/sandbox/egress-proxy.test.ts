/** The egress proxy over real sockets: a tunnel where allowed, a refusal anywhere else. */
import { request, type Server } from "node:http";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseDestinations,
  startEgressProxy,
} from "../../packages/sandbox/src/egress-proxy";

const portOf = (server: { address(): unknown }) =>
  (server.address() as AddressInfo).port;

describe("the egress proxy", () => {
  const echo = createServer((socket) => socket.pipe(socket));
  let proxy: Server;
  let allowedDestination: string;

  beforeAll(async () => {
    await new Promise<void>((listening) =>
      echo.listen(0, "127.0.0.1", listening),
    );
    allowedDestination = `127.0.0.1:${portOf(echo)}`;
    proxy = await startEgressProxy({
      host: "127.0.0.1",
      port: 0,
      allowed: [allowedDestination],
    });
  });

  afterAll(async () => {
    await new Promise((closed) => proxy.close(closed));
    await new Promise((closed) => echo.close(closed));
  });

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
  });

  it("reads its list from a comma-separated variable", () => {
    expect(
      parseDestinations(" Api.Anthropic.com:443, example.com:443,,"),
    ).toEqual(["api.anthropic.com:443", "example.com:443"]);
  });
});
