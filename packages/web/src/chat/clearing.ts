/**
 * Clearing the conversation, from the chat's own button or from the palette.
 * The transcript goes at once, and ctrl+z brings it back until the next turn.
 */
import { dismissToast, toast } from "../notifications/notify.svelte";
import { topbar, veilTopbar } from "../shell/topbar.svelte";
import { chat, clearChat, restoreChat } from "./chatState.svelte";

/** How long the offer to bring it back stays up. */
const OFFER_MS = 6000;

let offer: number | undefined;

/** Whether there is a conversation, finished, for a clear to take. */
export const canClear = () => !chat.busy && chat.entries.length > 0;

/**
 * A conversation on screen holds the nav's row, which comes back veiled so the
 * window settles while the dock travels to the centre; the dock's landing
 * shows it. Off screen the row was never taken, and nothing would unveil it.
 */
export function clearConversation() {
  if (!canClear()) return;
  if (topbar.tucked) veilTopbar();
  clearChat();
  offer = toast(
    "conversation cleared · ctrl+z brings it back",
    "accent",
    OFFER_MS,
  );
}

export function restoreConversation() {
  restoreChat();
  if (offer !== undefined) dismissToast(offer);
  offer = undefined;
}
