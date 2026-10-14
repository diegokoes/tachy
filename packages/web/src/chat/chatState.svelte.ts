import type { CompactStats } from "./CompactPanel.svelte";
import type { OutputFile } from "./OutputCard.svelte";
import type { CreatedTicket, WorkItemFile } from "@tachy/contract";
import type { ShownStep, WalkStep } from "../code/walkthrough";
import type { ModelPick } from "./modelCommand";
import type { TurnTrace } from "./trace";

export type EntryData =
  | { kind: "user"; text: string }
  | {
      kind: "assistant";
      text: string;
      /** The turn read linked code, so it can be shown as a walkthrough. */
      code?: true;
    }
  // Every tool called between two other entries, in the order called.
  | { kind: "tools"; calls: string[] }
  | { kind: "compact"; id: string; title: string; stats?: CompactStats }
  | { kind: "output"; id: string; file?: OutputFile }
  // What a ticket the agent just read has attached.
  | { kind: "files"; files: WorkItemFile[] }
  | {
      kind: "walkthrough";
      id: string;
      title: string;
      steps: WalkStep[];
      shown?: ShownStep[];
    }
  | {
      kind: "approval";
      id: string;
      tool: string;
      /** The tool input the user is editing - the object, not a JSON string. */
      input: Record<string, unknown>;
      /** Set only while the raw-JSON editor is open, so a half-typed payload
          can be invalid without destroying the parsed fields behind it. */
      raw?: string;
      status: "pending" | "approved" | "denied";
    }
  // Made from the composer, with no turn behind it.
  | {
      kind: "ticket";
      ticket: CreatedTicket;
      icon: string | null;
      color: string | null;
    }
  | { kind: "error"; text: string }
  // What the turn below sent to the agent, while debug is on.
  | { kind: "trace"; trace: TurnTrace }
  // The turn above was ended by the stop mark before it finished.
  | { kind: "stopped" }
  | { kind: "running"; turnId: string; text: string; stopped: boolean };

/** Stable per-entry key - index keys break on the export_table splice. */
export type Entry = EntryData & { key: number };

let nextKey = 1;

/** Push an entry, stamping it with a stable key. */
export function addEntry(e: EntryData): Entry {
  const full = { ...e, key: nextKey++ } as Entry;
  chat.entries.push(full);
  return full;
}

export const chat = $state({
  entries: [] as Entry[],
  input: "",
  busy: false,
  sessionId: undefined as string | undefined,
  turnId: undefined as string | undefined,
  /** Place in the server's queue while every chat slot is taken. */
  queuePosition: null as number | null,
  uploads: [] as { path: string; filename: string; image: boolean }[],
  artifact: undefined as { id: string; title: string } | undefined,
  /** Picked with `/model`, for this conversation only. */
  model: undefined as ModelPick | undefined,
  /** Switched with `/debug`: each turn shows what it sent to the agent. */
  debug: false,
});
