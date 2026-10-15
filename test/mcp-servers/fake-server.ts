/** Streamable HTTP MCP server. Each bearer token behaves one way: works, rate limited (-32029 or 429), or refused (401). */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const RATE_LIMIT_CODE = -32029;

export const TOKENS = {
  ok: "fake-token-ok-0001",
  other: "fake-token-ok-0002",
  limited: "fake-token-limited-0003",
  throttled: "fake-token-throttled-0004",
  refused: "fake-token-refused-0005",
} as const;

export interface FakeRemote {
  url: string;
  /** tools/call requests that reached a tool, by token. */
  calls: { token: string; tool: string; args: unknown }[];
  close(): Promise<void>;
}

function remoteServer(token: string, calls: FakeRemote["calls"]): McpServer {
  const server = new McpServer({ name: "fake-remote", version: "1.2.3" });
  server.registerTool(
    "events_search",
    {
      description: "Searches monitoring events.",
      inputSchema: {
        customer: z.string().optional(),
        application: z.string().optional(),
        query: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      calls.push({ token, tool: "events_search", args });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              hits: [{ id: "ev-1", message: "failed for ops@example.com" }],
              customer: args.customer ?? null,
              application: args.application ?? null,
              token,
            }),
          },
        ],
      };
    },
  );
  server.registerTool(
    "big_dump",
    {
      description: "Returns a large answer.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      calls.push({ token, tool: "big_dump", args: {} });
      return { content: [{ type: "text", text: "x".repeat(5000) }] };
    },
  );
  server.registerTool(
    "unhinted_lookup",
    { description: "Looks something up; says nothing about writing." },
    async () => {
      calls.push({ token, tool: "unhinted_lookup", args: {} });
      return { content: [{ type: "text", text: "looked up" }] };
    },
  );
  server.registerTool(
    "script_update",
    {
      description: "Changes a script.",
      annotations: { destructiveHint: true },
    },
    async () => ({ content: [{ type: "text", text: "changed" }] }),
  );
  server.registerTool(
    "failing_tool",
    { description: "Always fails.", annotations: { readOnlyHint: true } },
    async () => ({
      content: [{ type: "text", text: "Access to pool 7 not allowed" }],
      isError: true,
    }),
  );
  return server;
}

function bearer(header: string | undefined): string {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

export async function startFakeRemote(): Promise<FakeRemote> {
  const calls: FakeRemote["calls"] = [];
  const http: Server = createServer(async (request, response) => {
    const token = bearer(request.headers.authorization);
    if (
      token === TOKENS.refused ||
      !Object.values(TOKENS).includes(token as never)
    ) {
      response.writeHead(401).end("unauthorized");
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    if (body?.method === "tools/call" && token === TOKENS.throttled) {
      response.writeHead(429).end("slow down");
      return;
    }
    if (body?.method === "tools/call" && token === TOKENS.limited) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: RATE_LIMIT_CODE, message: "rate limit reached" },
        }),
      );
      return;
    }
    const server = remoteServer(token, calls);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
