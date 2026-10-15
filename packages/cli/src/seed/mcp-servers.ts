import { insertRows, type Tx } from "./batches";
import { uuidFor } from "./deterministic";
import type { SeededTeam, SeededUser } from "./org";

const DAY_MS = 86_400_000;
const TRAFFIC_DAYS = 7;

/**
 * One linked server with a stored catalog, a spent window and a week of
 * traffic. It points at an address that does not resolve: test and refresh
 * fail until an admin points it at a real server.
 */
export async function seedMcpServers(
  tx: Tx,
  teams: SeededTeam[],
  users: SeededUser[],
): Promise<void> {
  const admin = users.find((u) => u.role === "admin") ?? users[0];
  const team = teams[0];
  if (!admin || !team) return;
  const serverId = uuidFor("mcp-server", 0);
  const now = Date.now();

  await insertRows(
    tx,
    "mcp_servers",
    [
      "id",
      "slug",
      "name",
      "transport",
      "config",
      "credential_mode",
      "tool_prefix",
      "rate_windows",
      "rate_limit_codes",
      "argument_bindings",
      "note",
      "tools_refreshed_at",
      "created_by",
    ],
    [
      {
        id: serverId,
        slug: "monitoring",
        name: "Monitoring hub",
        transport: "http",
        config: {
          url: "https://monitoring.example.invalid/agents/mcp",
          headers: { Authorization: "Bearer {{token}}" },
        },
        credential_mode: "shared",
        tool_prefix: "mon",
        rate_windows: [
          { seconds: 60, limit: 15 },
          { seconds: 3600, limit: 150 },
        ],
        rate_limit_codes: [-32029],
        argument_bindings: { customer: "monitoring_customer" },
        note: "Timestamps are epoch milliseconds.",
        tools_refreshed_at: new Date(now - DAY_MS),
        created_by: admin.id,
      },
    ],
  );
  await insertRows(
    tx,
    "mcp_server_teams",
    ["server_id", "team_id"],
    [{ server_id: serverId, team_id: team.id }],
  );
  await insertRows(
    tx,
    "mcp_server_tools",
    [
      "server_id",
      "name",
      "description",
      "input_schema",
      "annotations",
      "exposed",
    ],
    [
      {
        server_id: serverId,
        name: "events_search",
        description: "Searches monitoring events by severity, time and key.",
        input_schema: {
          type: "object",
          properties: {
            customer: { type: "string" },
            severities: { type: "array", items: { type: "string" } },
            startTs: { type: "number" },
            endTs: { type: "number" },
          },
        },
        annotations: { readOnlyHint: true },
        exposed: true,
      },
      {
        server_id: serverId,
        name: "script_update",
        description: "Creates or changes a script.",
        input_schema: { type: "object" },
        annotations: { destructiveHint: true },
        exposed: false,
      },
    ],
  );
  const minute = new Date(Math.floor(now / 60_000) * 60_000);
  await insertRows(
    tx,
    "mcp_server_usage",
    ["server_id", "credential_key", "window_seconds", "window_start", "calls"],
    [
      {
        server_id: serverId,
        credential_key: "shared:svc-1",
        window_seconds: 60,
        window_start: minute,
        calls: 15,
      },
    ],
  );
  await insertRows(
    tx,
    "mcp_server_cooldowns",
    ["server_id", "credential_key", "until"],
    [
      {
        server_id: serverId,
        credential_key: "shared:svc-1",
        until: new Date(minute.getTime() + 60_000),
      },
    ],
  );
  await insertRows(
    tx,
    "mcp_server_calls",
    [
      "server_id",
      "day",
      "calls",
      "rate_limited",
      "auth_failures",
      "budget_refused",
    ],
    Array.from({ length: TRAFFIC_DAYS }, (_, daysAgo) => ({
      server_id: serverId,
      day: new Date(now - daysAgo * DAY_MS).toISOString().slice(0, 10),
      calls: 20 + daysAgo * 3,
      rate_limited: daysAgo % 3 === 0 ? 1 : 0,
      auth_failures: 0,
      budget_refused: daysAgo === 0 ? 2 : 0,
    })),
  );
}
