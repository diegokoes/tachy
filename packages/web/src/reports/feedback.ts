import { openSection, router } from "../shell/router.svelte";

/** Where the feedback view was opened from, so a report says what it is about. */
export const FEEDBACK_FROM = "tachy-feedback-from";

export function openFeedback() {
  sessionStorage.setItem(FEEDBACK_FROM, router.path);
  openSection("feedback");
}
