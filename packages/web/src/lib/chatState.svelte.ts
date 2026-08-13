import type { CompactStats } from "./chat/CompactPanel.svelte";
import type { OutputFile } from "./chat/OutputCard.svelte";

export type Entry =
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

export const chat = $state({
  entries: [] as Entry[],
  input: "",
  busy: false,
  sessionId: undefined as string | undefined,
  turnId: undefined as string | undefined,
  uploads: [] as { path: string; filename: string }[],
  artifact: undefined as { id: string; title: string } | undefined,
});
