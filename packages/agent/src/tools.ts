




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
  "list_source_product_maps",
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
  "add_source_product_map",
  "post_private_note",
  "record_analysis_run",
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
