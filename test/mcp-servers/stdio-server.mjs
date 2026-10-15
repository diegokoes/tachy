// A stdio MCP server for the linked-server suite. It reads its token from the
// file the connection wrote into its directory, the way a CLI gateway reads its
// config, and reports what it sees. Plain JavaScript: it runs from a temporary
// directory where tsx does not resolve.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "fake-stdio", version: "0.0.1" });
server.registerTool(
  "whoami",
  {
    description: "Reports the configured token.",
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          token: readFileSync("config/env.yaml", "utf8").trim(),
          greeting: process.env.FAKE_GREETING ?? null,
          arg: process.argv[2] ?? null,
          database: process.env.DATABASE_URL ?? null,
        }),
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
