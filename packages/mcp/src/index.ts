import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { loadSettingsIntoEnv } from "@tachy/core/config";
import { errorText, log } from "@tachy/core/infra";
import { registerSource, setSourceOrigin } from "@tachy/core/sources";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";
import { server } from "./server";
import { registerProxiedTools } from "./tools/mcp-servers";

registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

// Every source call this process makes is the agent reading or writing on
// somebody's behalf.
setSourceOrigin("agent");

// Imported for the registrations they perform: one file per domain, under
// the name core gives it.
import "./tools/work-items";
import "./tools/knowledge";
import "./tools/analytics";
import "./tools/catalog";
import "./tools/wiki";
import "./tools/reference";
import "./tools/files";
import "./tools/sources";
import "./tools/azure-devops";
import "./tools/code";
import "./tools/exports";
import "./tools/buckets";

export { server, registerProxiedTools };
export { runTool } from "./server";

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await loadSettingsIntoEnv();
  } catch {
    // The env alone still configures the server.
  }
  try {
    await registerProxiedTools();
  } catch (err) {
    // tachy's own tools still serve the turn.
    log("error", "mcp_server_tools_unavailable", { error: errorText(err) });
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
