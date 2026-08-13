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
    name: "compact",
    args: "<source> <ticket-id> [--no-note]",
    description: "Rebuild a repetitive ticket as a de-duplicated script",
    expand: (args) =>
      [
        "Run COMPACT MODE: resolve the connection slug via list_source_connections, then call compact_work_item for the ticket. Posting the transcript back as a private note is the point of this command — leave post_note at its default so it posts, and only pass post_note: false if the user's arguments include --no-note.",
        "Do NOT pass return_turns. The transcript belongs on the ticket, not in this conversation; the tool deliberately returns stats only.",
        "Then STOP and answer in at most four lines: the ticket title, messages in → turns out, what was dropped, and that the private note was posted (say how many notes). Do not paste, quote, summarise or re-order any turn — the compaction is deterministic and the note is the readable copy.",
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

/**
 * Writes a slash command exists to perform, so typing it is the authorisation
 * and no approval box is raised for that one tool. Keyed on the command the
 * user typed — never on anything the model chooses.
 */
const COMMAND_AUTO_APPROVE: Record<string, string[]> = {
  compact: ["compact_work_item"],
};

export const commandAutoApprove = (name: string): string[] =>
  COMMAND_AUTO_APPROVE[name] ?? [];
