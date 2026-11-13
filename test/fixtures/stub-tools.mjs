// tachy's MCP server as a runtime test needs it: a read, a write, and one that
// writes only when given URLs. Each call is appended to STUB_TOOLS_LOG.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const record = (line) =>
  appendFileSync(process.env.STUB_TOOLS_LOG, `${line}\n`);
const answer = (text) => ({ content: [{ type: "text", text }] });

const server = new McpServer({ name: "tachy", version: "0.0.0" });

server.registerTool(
  "search_knowledge",
  { inputSchema: { query: z.string() } },
  async () => {
    record("search_knowledge");
    return answer("no hits");
  },
);

server.registerTool(
  "ingest_context",
  {
    inputSchema: {
      text: z.string().optional(),
      urls: z.array(z.string()).optional(),
    },
  },
  async ({ urls }) => {
    record(urls?.length ? "ingest_context urls" : "ingest_context text");
    return answer("loaded");
  },
);

server.registerTool(
  "post_private_note",
  {
    inputSchema: {
      source: z.string(),
      external_id: z.string(),
      body: z.string(),
    },
  },
  async ({ body }) => {
    record(`post_private_note ${body}`);
    return answer("posted");
  },
);

// Stands in for the real check: one note the tool throws on, one it answers
// with a result that says why.
if (process.env.STUB_TOOLS_CHECK)
  server.registerTool(
    "check_write",
    {
      inputSchema: {
        tool: z.string(),
        input: z.record(z.string(), z.unknown()),
      },
    },
    async ({ input }) => {
      if (input.body === "forbidden")
        return { ...answer("no right to post here"), isError: true };
      if (input.body === "duplicate") return answer("already posted");
      return { content: [] };
    },
  );

await server.connect(new StdioServerTransport());
