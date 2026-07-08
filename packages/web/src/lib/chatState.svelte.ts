// Chat state lives at module level so the conversation survives ChatView
// being unmounted on view switches — and a stream in flight keeps appending
// here while another view is showing. Cleared only on full page reload.

export type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string }
  | { kind: "approval"; id: string; tool: string; editable: string; status: "pending" | "approved" | "denied" }
  | { kind: "error"; text: string };

export const chat = $state({
  entries: [] as Entry[],
  input: "",
  busy: false,
  sessionId: undefined as string | undefined,
  turnId: undefined as string | undefined,
  uploads: [] as { path: string; filename: string }[],
});
