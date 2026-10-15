import { z } from "zod";
import { log } from "../infra/log";
import { errorText } from "../infra/known-secrets";
import { count } from "../jobs/present";
import { defineJob } from "../jobs/registry";
import { sweepUsage } from "./budget";
import { refreshTools } from "./catalog";
import { poolTokens } from "./credentials";
import { listMcpServers } from "./servers";

export const REFRESH_KIND = "mcp-server.refresh";

/**
 * A personal server is left out: its tools/list answers for whoever's token
 * asks, and a job has nobody's. An admin refreshes it from the console.
 */
async function refreshSharedServers(): Promise<Record<string, unknown>> {
  const refreshed: string[] = [];
  const failed: Record<string, string> = {};
  for (const server of await listMcpServers()) {
    if (!server.enabled || server.credential_mode !== "shared") continue;
    const [credential] = await poolTokens(server.slug);
    if (!credential) continue;
    try {
      await refreshTools(server, credential.token);
      refreshed.push(server.slug);
    } catch (err) {
      failed[server.slug] = errorText(err);
      log("warn", "mcp_server_refresh_failed", {
        server: server.slug,
        error: failed[server.slug],
      });
    }
  }
  return { refreshed, failed, swept: await sweepUsage() };
}

export function defineMcpServerJobs() {
  defineJob({
    kind: REFRESH_KIND,
    title: "Refresh linked MCP servers' tools",
    description:
      "Asks every enabled shared-pool MCP server for its tool list and stores it, so a new or changed tool shows in the console and a tool that turned destructive stops being offered. Clears spent rate windows.",
    params: z.object({}),
    defaultSchedule: "30 4 * * *",
    dedupeKey: () => REFRESH_KIND,
    timeout: "15m",
    outcome: (output) => {
      const refreshed = (output.refreshed as string[] | undefined) ?? [];
      const failed = Object.keys((output.failed as object | undefined) ?? {});
      return failed.length
        ? `${count(refreshed.length, "server")} refreshed, ${failed.join(", ")} failed`
        : `${count(refreshed.length, "server")} refreshed`;
    },
    run: async () => refreshSharedServers(),
  });
}
