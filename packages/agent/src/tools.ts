// The security boundary. The agent is granted ONLY these tachy MCP tools; every
// built-in Claude Code tool (file/bash/web) is disabled. Reads auto-run; writes
// require explicit human approval (canUseTool → frontend). Anything not listed is
// denied by canUseTool regardless of what the model attempts.

export const MCP_SERVER = "tachy";

// Auto-run: read/consult/search. No side effects.
export const READ_TOOLS = [
  "search_knowledge",
  "get_context",
  "fetch_work_item",
  "get_knowledge_entry",
  "list_knowledge_entries",
  "search_reference",
  "list_reference_docs",
  "get_reference_doc",
  "ingest_context",
  "list_resolution_patterns",
  "list_environments",
  "list_components",
  "list_customers",
  "list_teams",
  "list_products",
  "list_labels",
  "list_source_connections",
  "list_source_product_maps",
] as const;

// Require human approval before running (persist or write-back).
export const WRITE_TOOLS = [
  "save_knowledge_entry",
  "update_knowledge_entry",
  "save_reference_doc",
  "update_reference_doc",
  "add_knowledge_feedback",
  "add_resolution_pattern",
  "add_component",
  "add_customer",
  "add_label",
  "add_team",
  "add_product",
  "set_work_item_customer",
  "set_observed_version",
  "add_source_connection",
  "add_source_product_map",
  "post_private_note",
  "record_analysis_run",
] as const;

// Built-in Claude Code tools we explicitly refuse — belt-and-suspenders alongside
// canUseTool's default-deny, so the model isn't even offered file/shell/web access.
export const DISALLOWED_BUILTINS = [
  "Bash",
  "BashOutput",
  "KillBash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
  "SlashCommand",
];

export const qualify = (base: string) => `mcp__${MCP_SERVER}__${base}`;

const READ = new Set<string>(READ_TOOLS);
const WRITE = new Set<string>(WRITE_TOOLS);

export type ToolClass = "read" | "write" | "denied";

// Classify a fully-qualified tool name from a tool call.
export function classify(toolName: string): { cls: ToolClass; base: string } {
  const prefix = `mcp__${MCP_SERVER}__`;
  if (!toolName.startsWith(prefix)) return { cls: "denied", base: toolName };
  const base = toolName.slice(prefix.length);
  if (READ.has(base)) return { cls: "read", base };
  if (WRITE.has(base)) return { cls: "write", base };
  // Unknown tachy tool → treat as a write (approval-gated), never silently run.
  return { cls: "write", base };
}
