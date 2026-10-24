/** What a write the agent asks to make will do, said before it happens. */
const ACTIONS: Record<string, string> = {
  post_private_note: "post a private note",
  post_work_item_summary: "post a summary",
  create_ado_work_item: "create a work item",
  compact_work_item: "compact the ticket",
  save_knowledge_entry: "save an entry",
  update_knowledge_entry: "update an entry",
  save_reference_doc: "save a doc",
  update_reference_doc: "update a doc",
  save_wiki_article: "save an article",
  save_library_image: "keep an image",
  set_work_item_customer: "set the ticket's customer",
  set_customer_fact: "record a customer fact",
  set_customer_component: "record a component they run",
  set_observed_version: "record a version",
  add_knowledge_feedback: "leave feedback",
};

const TACHY_PREFIX = "mcp__tachy__";

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** The approval card's title: the action, then the source and item it acts on. */
export function approvalTitle(
  tool: string,
  input: Record<string, unknown>,
): string {
  const name = tool.startsWith(TACHY_PREFIX)
    ? tool.slice(TACHY_PREFIX.length)
    : tool;
  const action = ACTIONS[name] ?? name.replaceAll("_", " ");
  const id = text(input.external_id);
  const where = [text(input.source), id ? `#${id}` : text(input.project)]
    .filter(Boolean)
    .join(" ");
  return where ? `${action} · ${where}` : action;
}
