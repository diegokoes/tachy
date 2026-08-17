import type { CompactStats } from "./chat/CompactPanel.svelte";
import type { OutputFile } from "./chat/OutputCard.svelte";

export type EntryData =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string }
  | { kind: "compact"; id: string; title: string; stats?: CompactStats }
  | { kind: "output"; id: string; file?: OutputFile }
  | {
      kind: "approval";
      id: string;
      tool: string;
      editable: string;
      status: "pending" | "approved" | "denied";
    }
  | { kind: "error"; text: string };

/** Stable per-entry key — index keys break on the export_table splice. */
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
  uploads: [] as { path: string; filename: string }[],
  artifact: undefined as { id: string; title: string } | undefined,
});
