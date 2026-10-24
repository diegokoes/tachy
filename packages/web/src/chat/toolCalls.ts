export interface ToolTally {
  tool: string;
  count: number;
}

/** A run of tool calls in order, with back-to-back repeats counted as one. */
export function tallyCalls(calls: readonly string[]): ToolTally[] {
  const tallies: ToolTally[] = [];
  for (const tool of calls) {
    const last = tallies[tallies.length - 1];
    if (last?.tool === tool) last.count += 1;
    else tallies.push({ tool, count: 1 });
  }
  return tallies;
}

/**
 * What a tool call did, as the chat says it under an answer. Raw names stay in
 * /debug and the trace, where someone is reading the plumbing.
 */
const TOOL_WORDS: Record<string, string> = {
  search_knowledge: "searched the library",
  search_reference: "searched the docs",
  search_code: "searched code",
  search_bucket: "searched a bucket",
  get_context: "read the ticket",
  fetch_work_item: "fetched the ticket",
  read_code_file: "read a file",
  read_file: "opened a file",
  list_code_tree: "listed a repo",
  code_history: "read the history",
  code_diff: "compared code",
  code_changes_between: "compared releases",
  code_releases_containing: "found the releases",
  get_knowledge_entry: "read an entry",
  get_reference_doc: "read a doc",
  get_bucket_doc: "read a bucket doc",
  get_customer_profile: "read the customer",
  get_project_context: "read the project",
  get_ado_wiki_page: "read a wiki page",
  get_ado_work_item_schema: "read the item's form",
  save_knowledge_entry: "saved an entry",
  update_knowledge_entry: "updated an entry",
  save_reference_doc: "saved a doc",
  update_reference_doc: "updated a doc",
  save_wiki_article: "saved an article",
  draft_wiki_page: "drafted an article",
  post_private_note: "posted a private note",
  post_work_item_summary: "posted a summary",
  create_ado_work_item: "created a work item",
  compact_work_item: "compacted the ticket",
  show_code_walkthrough: "drew a walkthrough",
  export_table: "exported a table",
  record_analysis_run: "recorded the analysis",
  add_knowledge_feedback: "left feedback",
  set_work_item_customer: "set the customer",
  ingest_context: "took in the context",
};

const TACHY_PREFIX = "mcp__tachy__";
/** A linked server's tool: mcp__<server>__<tool>. */
const LINKED_RE = /^mcp__(.+?)__(.+)$/;

const spaced = (name: string) => name.replaceAll("_", " ");

/** A tool's name as words: the known phrase, else its name spelled out. */
export function toolWords(tool: string): string {
  const name = tool.startsWith(TACHY_PREFIX)
    ? tool.slice(TACHY_PREFIX.length)
    : tool;
  const linked = LINKED_RE.exec(name);
  if (linked) return `${linked[1]}: ${spaced(linked[2])}`;
  return TOOL_WORDS[name] ?? spaced(name);
}

export const tallyLabel = (tally: ToolTally): string =>
  tally.count > 1
    ? `${toolWords(tally.tool)} ×${tally.count}`
    : toolWords(tally.tool);
