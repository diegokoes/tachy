export type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; tool: string }
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
});
