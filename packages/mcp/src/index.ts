import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { loadSettingsIntoEnv } from "@tachy/core/config";
import { registerSource, setSourceOrigin } from "@tachy/core/sources";
import { createFreshdeskSource } from "@tachy/source-freshdesk";
import { createGithubSource } from "@tachy/source-github";
import { createAzureDevopsSource } from "@tachy/source-azure-devops";
import { server } from "./server";

/*
 * Before the tool modules, which resolve sources as soon as they are called.
 */
registerSource("freshdesk", createFreshdeskSource);
registerSource("github", createGithubSource);
registerSource("azure-devops", createAzureDevopsSource);

/* Every source call this process makes is the agent reading or writing on
   somebody's behalf. */
setSourceOrigin("agent");

/*
 * Imported for the registrations they perform. One file per domain, under the
 * name core gives it — a tool sits beside the others that read and write the
 * same tables.
 */
import "./tools/work-items";
import "./tools/knowledge";
import "./tools/analytics";
import "./tools/catalog";
import "./tools/wiki";
import "./tools/reference";
import "./tools/sources";
import "./tools/azure-devops";
import "./tools/code";
import "./tools/exports";
import "./tools/buckets";

export { server };
export { runTool } from "./server";

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await loadSettingsIntoEnv();
  } catch {
    /* keep env-only behavior */
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
