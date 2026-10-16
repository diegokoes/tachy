import type { WorkItemPeek } from "@tachy/contract";
import { api } from "../api";
import { errText } from "../resource.svelte";

/** Long enough that a number typed at speed is one request. */
const TYPING_PAUSE_MS = 300;

export type PeekState =
  | { status: "idle" }
  | { status: "looking"; id: string }
  | { status: "found"; id: string; peeks: WorkItemPeek[] }
  | { status: "failed"; id: string; message: string };

export const peek = $state<{ current: PeekState }>({
  current: { status: "idle" },
});

const peeksById = new Map<string, WorkItemPeek[]>();
let asked = 0;

/** `#123` and `123` name the same item. */
export const workItemNumber = (text: string): string | null => {
  const match = text.match(/^#?(\d+)$/);
  return match ? match[1] : null;
};

/** Looks the item up once typing pauses; the returned function cancels it. */
export function peekLater(id: string): () => void {
  const mine = ++asked;
  const known = peeksById.get(id);
  if (known) {
    peek.current = { status: "found", id, peeks: known };
    return () => {};
  }
  peek.current = { status: "looking", id };
  const pause = setTimeout(async () => {
    try {
      const peeks = await api.get<WorkItemPeek[]>(
        `/work-items/peek/azure-devops/${id}`,
      );
      // A miss is not kept: the item may be created a moment later.
      if (peeks.length) peeksById.set(id, peeks);
      if (mine === asked) peek.current = { status: "found", id, peeks };
    } catch (e) {
      if (mine === asked)
        peek.current = { status: "failed", id, message: errText(e) };
    }
  }, TYPING_PAUSE_MS);
  return () => clearTimeout(pause);
}

export function clearPeek(): void {
  asked++;
  peek.current = { status: "idle" };
}
