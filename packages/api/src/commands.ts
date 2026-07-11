export interface BuiltinCommand {
  name: string;
  args: string;
  description: string;
  expand: (args: string) => string;
}

const argsLine = (args: string) =>
  args.trim()
    ? `User arguments: ${args.trim()}`
    : "User arguments: (none — ask for what's missing)";

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "analyze",
    args: "<source> <ticket-id>",
    description: "Ingest a ticket and draft a knowledge entry for review",
    expand: (args) =>
      [
        "Run INGEST MODE exactly as defined in your instructions: load list_resolution_patterns and list_components, fetch the work item, read all messages chronologically, and produce a structured knowledge entry for review. Do not save anything before the user approves.",
        "If the source the user typed is a type or alias rather than a connection slug, resolve it via list_source_connections. If the fetched item carries linked_ado_refs, offer to pull those Azure DevOps items as extra context (one level only).",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "consult",
    args: "<source> <ticket-id>",
    description: "Fetch a ticket and search prior knowledge for advice",
    expand: (args) =>
      [
        "Run CONSULT MODE exactly as defined in your instructions: call get_context for the ticket, weigh the similar entries (flag any status 'deprecated' as outdated) and reference docs, then synthesize actionable guidance. Do not save anything.",
        "If the source the user typed is a type or alias rather than a connection slug, resolve it via list_source_connections. If linked_ado_refs is present, offer to pull the linked Azure DevOps items for context.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "create-ticket",
    args: "[project] [summary...]",
    description: "Create an Azure DevOps work item (schema-checked)",
    expand: (args) =>
      [
        "Run CREATION MODE: find the azure-devops connection via list_source_connections, then ALWAYS call get_ado_work_item_schema for the target project (and type) before drafting — required fields differ per project and type, never guess them. Draft the full field set, present it, and call create_ado_work_item; the tool-approval box is the user's review. Afterwards report the created work item URL.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "code",
    args: "<question>",
    description: "Answer a question from the linked codebases",
    expand: (args) =>
      [
        "Run CODE CONSULTATION MODE: call list_repos to see what is indexed (mention stale or erroring indexes), search_code with symptom/symbol/error terms, then read_code_file narrowly around the best hits. Reason from the snippets — cite every claim as path:start-end @ commit and disclose the index age. Never paste whole files into the answer or into saved entries.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "ingest-wiki",
    args: "<source> <project> [wiki] [page-path]",
    description: "Pull Azure DevOps wiki pages into reference docs",
    expand: (args) =>
      [
        "Run the ADO WIKI flow from Context dump mode: list_ado_wikis / list_ado_wiki_pages to locate the page(s), get_ado_wiki_page to read them, classify each part (reference doc vs knowledge entry vs component proposal), and present the routing for approval. Save only after the user approves, citing the page's remote_url as the doc source.",
        argsLine(args),
      ].join("\n"),
  },
];

export const findCommand = (name: string): BuiltinCommand | undefined =>
  BUILTIN_COMMANDS.find((c) => c.name === name);
