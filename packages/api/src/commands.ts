export interface Subcommand {
  name: string;
  args: string;
  description: string;
  /** Handled by the web app itself, with no agent turn at all. */
  client?: true;
  expand?: (args: string) => string;
}

export interface BuiltinCommand {
  name: string;
  args: string;
  description: string;
  expand: (args: string) => string;
  /** A group command: the first argument picks one of these. */
  subcommands?: Subcommand[];
  /** Sent by a control in the web app, never picked from the command menu. */
  hidden?: true;
}

const argsLine = (args: string) =>
  args.trim()
    ? `User arguments: ${args.trim()}`
    : "User arguments: (none - ask for what's missing)";

/**
 * Each expansion names its mode and adds only what the command changes about
 * it. The steps live once, in the agent prompt; the per-tool mechanics live
 * once, on the tools. Restating either here puts them out of step.
 */
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: "compact",
    args: "<source> <ticket-id> [--no-note]",
    description: "rebuild a repetitive ticket as a de-duplicated script",
    expand: (args) =>
      [
        "Run COMPACT MODE as defined in your instructions, calling compact_work_item for the ticket. Posting the transcript back as a private note is the point of this command - leave post_note at its default so it posts, and only pass post_note: false if the user's arguments include --no-note.",
        "Do NOT pass return_turns. The transcript belongs on the ticket, not in this conversation.",
        "Then STOP and answer in at most four lines: the ticket title, messages in → turns out, what was dropped, and that the private note was posted (say how many notes).",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "summary",
    args: "<source> <ticket-id>",
    description: "post a summary of a ticket onto it as a private note",
    // Self-contained, so the steps are paid for on the click, not every turn.
    expand: (args) =>
      [
        "Summarise one ticket and post the summary onto it. Save nothing else.",
        "fetch_work_item, then read every message chronologically, linked_items included. Of its files, open with read_file the ones that bear on the problem, a screenshot of the error or a log, and at most five; say in the summary's files what each shows. Call post_work_item_summary with what the thread and those files establish; it replaces the summary an earlier run posted.",
        "Then STOP and answer in at most two lines: the ticket title, and that the summary was posted.",
        argsLine(args),
      ].join("\n"),
  },
  group("az", "Azure DevOps work items", [
    {
      name: "new",
      args: "[project] [type]",
      description: "compose a work item with the project's own fields",
      client: true,
    },
    {
      name: "explain",
      args: "<id>",
      description: "explain a work item: what, why, where it stands, what next",
      // Self-contained: this is paid only when someone types it, where a mode
      // in prompt.md is paid on every message.
      expand: (args) =>
        [
          "Explain one Azure DevOps work item to the user. Read only; save nothing.",
          "Fetch it with fetch_work_item on the azure-devops connection (list_source_connections if you do not know its slug). Its linked_items arrive with it; do not fetch further.",
          "Answer briefly, in this order: what it asks for or reports; why it exists (the problem, who raised it); where it stands (state, assignee, iteration, anything blocking); how it connects (parent, children, related items, pull requests); and the sensible next step. Say plainly what the item does not tell you.",
          argsLine(args),
        ].join("\n"),
    },
  ]),
  {
    name: "walkthrough",
    args: "",
    description: "show the last code answer as a stepped walkthrough",
    hidden: true,
    // Self-contained for the same reason as /az explain: paid on the click.
    expand: () =>
      [
        "Turn your last code answer in this conversation into a walkthrough with show_code_walkthrough.",
        "Three to eight steps in execution order, each the narrowest range that shows its point, with the lines that decide the outcome highlighted and a note of one or two sentences. Use only ranges you have already read, at the same version or ref; read more only if a step of the flow is missing.",
        "If this conversation holds no code answer yet, say so in one line instead.",
      ].join("\n"),
  },
  {
    name: "ingest-wiki",
    args: "<source> <project> [wiki] [page-path]",
    description: "pull Azure DevOps wiki pages into reference docs",
    hidden: true,
    expand: (args) =>
      [
        "Run the ADO WIKI flow of CONTEXT DUMP MODE as defined in your instructions.",
        argsLine(args),
      ].join("\n"),
  },
  {
    name: "wiki-draft",
    args: "<product> [component=<slug>] [article=<slug>]",
    description: "write or refresh a wiki article from recorded knowledge",
    hidden: true,
    expand: (args) =>
      [
        "Write one wiki article for this product from what the library has recorded, never from general knowledge; draft_wiki_page and save_wiki_article describe the steps.",
        "With no component named, take the first gap list_wiki_gaps returns for the product. With article=<slug>, this is a refresh: read that article first and keep its slug, so the save updates the page in place.",
        argsLine(args),
      ].join("\n"),
  },
];

/**
 * A command whose first argument picks a subcommand. A client-only one that
 * still reaches the server (typed through the API, say) gets a pointer back to
 * the app rather than a turn spent guessing.
 */
function group(
  name: string,
  description: string,
  subcommands: Subcommand[],
): BuiltinCommand {
  const names = subcommands.map((s) => s.name).join(", ");
  return {
    name,
    args: `<${subcommands.map((s) => s.name).join("|")}> ...`,
    description,
    subcommands,
    expand: (args) => {
      const [first = "", ...rest] = args.trim().split(/\s+/);
      const sub = subcommands.find((s) => s.name === first);
      if (sub?.expand) return sub.expand(rest.join(" "));
      return sub
        ? `Reply in one line: /${name} ${sub.name} runs in the tachy web app's chat composer, not here.`
        : `Reply in one line: /${name} takes one of: ${names}.`;
    },
  };
}

export const findCommand = (name: string): BuiltinCommand | undefined =>
  BUILTIN_COMMANDS.find((c) => c.name === name);

/**
 * Writes a slash command exists to perform, so typing it is the authorisation
 * and no approval box is raised for that one tool. Keyed on the command the
 * user typed, never on anything the model chooses.
 */
const COMMAND_AUTO_APPROVE: Record<string, string[]> = {
  compact: ["compact_work_item"],
  summary: ["post_work_item_summary"],
};

export const commandAutoApprove = (name: string): string[] =>
  COMMAND_AUTO_APPROVE[name] ?? [];
