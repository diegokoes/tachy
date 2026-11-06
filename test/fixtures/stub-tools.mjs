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
  async () => {
    record("post_private_note");
    return answer("posted");
  },
);

await server.connect(new StdioServerTransport());
