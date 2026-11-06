/**
 * The sandboxes' only way out: an HTTP CONNECT proxy that tunnels to the
 * host:port pairs it was given and refuses everything else.
 */
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { logEvent } from "./log";

export const DEFAULT_EGRESS = ["api.anthropic.com:443"];

export interface EgressSettings {
  host: string;
  port: number;
  /** `host:port` pairs, matched exactly, host without regard to case. */
  allowed: readonly string[];
}

/** A comma-separated `host:port` list, as an env variable holds it. */
export const parseDestinations = (list: string): string[] =>
  list
    .split(",")
    .map((destination) => destination.trim().toLowerCase())
    .filter(Boolean);

function splitDestination(destination: string): { host: string; port: number } {
  const colon = destination.lastIndexOf(":");
  return {
    host: destination.slice(0, colon),
    port: Number(destination.slice(colon + 1)),
  };
}

export function startEgressProxy(settings: EgressSettings): Promise<Server> {
  const allowed = new Set(settings.allowed.map((entry) => entry.toLowerCase()));
  const server = createServer((_request, response) =>
    response.writeHead(405).end(),
  );
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (request, client, head) => {
    client.on("error", () => {});
    const destination = (request.url ?? "").toLowerCase();
    if (!allowed.has(destination)) {
      logEvent("warn", "egress_refused", { destination });
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const { host, port } = splitDestination(destination);
    const upstream = connect(port, host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  return new Promise((listening) =>
    server.listen(settings.port, settings.host, () => listening(server)),
  );
}
