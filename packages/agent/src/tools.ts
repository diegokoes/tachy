export const MCP_SERVER = "tachy";

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
  "list_source_projects",
  "get_project_context",
  "list_ado_wikis",
  "list_ado_wiki_pages",
  "get_ado_wiki_page",
  "get_ado_work_item_schema",
  "list_repos",
  "search_code",
  "read_code_file",
  "export_table",
] as const;

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
  "add_source_project",
  "set_project_area_map",
  "post_private_note",
  "record_analysis_run",
  "create_ado_work_item",
] as const;

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

export function classify(toolName: string): { cls: ToolClass; base: string } {
  const prefix = `mcp__${MCP_SERVER}__`;
  if (!toolName.startsWith(prefix)) return { cls: "denied", base: toolName };
  const base = toolName.slice(prefix.length);
  if (READ.has(base)) return { cls: "read", base };
  if (WRITE.has(base)) return { cls: "write", base };

  return { cls: "write", base };
}

/** Tools whose class depends on their arguments, keyed by the flag that makes them a write. */
const CONDITIONAL_WRITES: Record<string, string> = {
  compact_work_item: "post_note",
};

/**
 * Same as `classify`, but lets a tool that only sometimes writes stay read-only
 * until the writing flag is actually set.
 */
export function classifyCall(
  toolName: string,
  input: unknown,
): { cls: ToolClass; base: string } {
  const c = classify(toolName);
  const flag = CONDITIONAL_WRITES[c.base];
  if (c.cls === "denied" || !flag) return c;
  const writes =
    typeof input === "object" &&
    input !== null &&
    (input as Record<string, unknown>)[flag] === true;
  return { cls: writes ? "write" : "read", base: c.base };
}
