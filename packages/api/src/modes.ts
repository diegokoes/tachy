import type { ChatModeName } from "@tachy/core";

export interface ChatMode {
  name: ChatModeName;
  /** What follows the command, in words, for the menu; never parsed. */
  args: string;
  description: string;
  expand: (args: string) => string;
}

const CODE_ANSWER_SHAPE = [
  "Shape of the answer: when the question asks how something works, flows or is processed, show it. Read the code, call show_code_walkthrough with the stages as steps, then write at most six lines: the flow in one sentence, and anything the steps cannot carry. Do not write the stages out in prose as well.",
  "For any other question, answer in the first sentence and stop when it is answered. Name an index only when it is stale, failing or partial for a repo in scope; leave out what you did not use.",
].join("\n");

/**
 * A mode holds for every message until the user leaves it, so its expansion is
 * sent on each of them: it names the mode and adds only what the mode changes.
 */
export const CHAT_MODE_LIST: ChatMode[] = [
  {
    name: "analyze",
    args: "ticket",
    description: "turn tickets into knowledge entries for review",
    expand: (args) =>
      [
        "Run INGEST MODE as defined in your instructions for every ticket the user names.",
        args.trim() ? `Ticket: ${args.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    name: "code",
    args: "",
    description: "answer from the linked codebases",
    expand: () =>
      [
        "Run CODE CONSULTATION MODE as defined in your instructions.",
        CODE_ANSWER_SHAPE,
      ].join("\n"),
  },
];

export const findMode = (name: ChatModeName): ChatMode | undefined =>
  CHAT_MODE_LIST.find((m) => m.name === name);
