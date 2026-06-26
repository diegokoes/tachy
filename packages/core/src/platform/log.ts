// Minimal structured logger. Writes one JSON line to STDERR — never stdout, which
// the MCP server reserves for the protocol stream. Good enough for tracing tool
// calls (name, outcome, duration) without pulling in pino/winston.
export function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  process.stderr.write(line + "\n");
}
