import { api } from "../api";
import { session } from "../access/session.svelte";
import type { NotificationRow } from "@tachy/contract";

export interface Toast {
  id: number;
  tone: "ok" | "accent" | "danger";
  text: string;
}

/**
 * The app's one notification surface. `items` are durable, per-user rows
 * fetched from the server, such as an admin's reply to a report; `toasts` are
 * transient, client-only confirmations. Both render through NotificationHost.
 */
export const notifyState = $state<{
  items: NotificationRow[];
  toasts: Toast[];
  loaded: boolean;
}>({ items: [], toasts: [], loaded: false });

let toastSeq = 0;

/** Shows a toast for `ms`, or until dismissed when `ms` is 0. Returns its id. */
export function toast(
  text: string,
  tone: Toast["tone"] = "ok",
  ms = 4000,
): number {
  const id = ++toastSeq;
  notifyState.toasts.push({ id, tone, text });
  if (ms > 0) setTimeout(() => dismissToast(id), ms);
  return id;
}

export function dismissToast(id: number): void {
  notifyState.toasts = notifyState.toasts.filter((t) => t.id !== id);
}

export const unread = (): NotificationRow[] =>
  notifyState.items.filter((n) => !n.read_at);

/** Admins' replies to the reader's reports that have not been acknowledged. */
export const unreadReplies = (): NotificationRow[] =>
  unread().filter((n) => n.kind === "report_reply");

/** Changes on items the reader follows, and flow notices, newest first. */
export const itemChanges = (): NotificationRow[] =>
  notifyState.items.filter(
    (n) => n.kind === "work_item_changed" || n.kind === "flow_notice",
  );

export async function refreshNotifications(): Promise<void> {
  if (!session.me) return;
  try {
    notifyState.items = await api.get<NotificationRow[]>("/me/notifications");
    notifyState.loaded = true;
  } catch {
    // A failed poll is not worth surfacing; the next one recovers.
  }
}

export async function markNotificationsSeen(): Promise<void> {
  const now = new Date().toISOString();
  notifyState.items = notifyState.items.map((n) =>
    n.seen_at ? n : { ...n, seen_at: now },
  );
  try {
    await api.post("/me/notifications/seen", {});
  } catch {
    // Optimistic; the next refresh reconciles.
  }
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  notifyState.items = notifyState.items.map((n) =>
    ids.includes(n.id) ? { ...n, read_at: now, seen_at: n.seen_at ?? now } : n,
  );
  try {
    await api.post("/me/notifications/read", { ids });
  } catch {
    // Optimistic: the local mark stands, the next refresh reconciles.
  }
}

/**
 * Polls every minute and on tab refocus: the app has no push channel, and an
 * admin's reply is not time-critical. The first fetch is App's, once the
 * session knows who is signed in; a fetch at mount would find no one.
 */
export function startNotifications(): () => void {
  const timer = setInterval(refreshNotifications, 60_000);
  const onFocus = () => void refreshNotifications();
  window.addEventListener("focus", onFocus);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}
