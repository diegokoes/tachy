/**
 * The sandboxes' only way out: an HTTP proxy that tunnels (CONNECT) or
 * forwards (absolute-form HTTP) to the host:port pairs it was given, and
 * refuses everything else.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
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

const DEFAULT_HTTP_PORT = "80";
/** Headers meant for this hop, not for the destination. */
const HOP_HEADERS = [
  "proxy-connection",
  "proxy-authorization",
  "connection",
  "keep-alive",
];

/** Claude Code sends a plain-http model address through the proxy in absolute form. */
function forwardHttp(
  request: IncomingMessage,
  response: ServerResponse,
  allowed: ReadonlySet<string>,
): void {
  const target = URL.canParse(request.url ?? "") ? new URL(request.url!) : null;
  if (target?.protocol !== "http:") return void response.writeHead(405).end();
  const port = target.port || DEFAULT_HTTP_PORT;
  const destination = `${target.hostname.toLowerCase()}:${port}`;
  if (!allowed.has(destination)) {
    logEvent("warn", "egress_refused", { destination });
    return void response.writeHead(403).end();
  }
  const headers = { ...request.headers };
  for (const name of HOP_HEADERS) delete headers[name];
  const upstream = httpRequest(
    {
      host: target.hostname,
      port,
      method: request.method,
      path: target.pathname + target.search,
      headers,
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  request.pipe(upstream);
}

export function startEgressProxy(settings: EgressSettings): Promise<Server> {
  const allowed = new Set(settings.allowed.map((entry) => entry.toLowerCase()));
  const server = createServer((request, response) =>
    forwardHttp(request, response, allowed),
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
