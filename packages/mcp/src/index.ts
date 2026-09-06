import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { loadSettingsIntoEnv, registerSource } from "@tachy/core";
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

/*
 * Imported for the registrations they perform, in the order the tools were
 * written in — a tool sits beside the others that read and write the same
 * tables, and beside the helpers only they use.
 */
import "./tools/consult";
import "./tools/catalog";
import "./tools/knowledge";
import "./tools/library";
import "./tools/org";
import "./tools/sources";
import "./tools/azure-devops";
import "./tools/code";
import "./tools/exports";

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
