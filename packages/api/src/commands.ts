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

/**
 * Each expansion names its mode and adds only what the command changes about it.
 * The steps themselves live once, in the agent prompt; the per-tool mechanics
 * live once, on the tools. Restating either here just puts them out of step.
 */
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "analyze",
    args: "<source> <ticket-id>",
    description: "Ingest a ticket and draft a knowledge entry for review",
    expand: (args) =>
      [
        "Run INGEST MODE as defined in your instructions. Do not save anything before the user approves.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "consult",
    args: "<source> <ticket-id>",
    description: "Fetch a ticket and search prior knowledge for advice",
    expand: (args) =>
      [
        "Run CONSULT MODE as defined in your instructions. Do not save anything.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "compact",
    args: "<source> <ticket-id> [--no-note]",
    description: "Rebuild a repetitive ticket as a de-duplicated script",
    expand: (args) =>
      [
        "Run COMPACT MODE as defined in your instructions, calling compact_work_item for the ticket. Posting the transcript back as a private note is the point of this command — leave post_note at its default so it posts, and only pass post_note: false if the user's arguments include --no-note.",
        "Do NOT pass return_turns. The transcript belongs on the ticket, not in this conversation.",
        "Then STOP and answer in at most four lines: the ticket title, messages in → turns out, what was dropped, and that the private note was posted (say how many notes).",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "create-ticket",
    args: "[project] [summary...]",
    description: "Create an Azure DevOps work item (schema-checked)",
    expand: (args) =>
      [
        "Run CREATION MODE as defined in your instructions.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "code",
    args: "<question>",
    description: "Answer a question from the linked codebases",
    expand: (args) =>
      [
        "Run CODE CONSULTATION MODE as defined in your instructions.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "ingest-wiki",
    args: "<source> <project> [wiki] [page-path]",
    description: "Pull Azure DevOps wiki pages into reference docs",
    expand: (args) =>
      [
        "Run the ADO WIKI flow of CONTEXT DUMP MODE as defined in your instructions. Save only after the user approves.",
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
