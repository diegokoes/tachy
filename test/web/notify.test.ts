import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRow } from "@tachy/contract";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../packages/web/src/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api,
}));

const { session } =
  await import("../../packages/web/src/access/session.svelte");
const {
  markNotificationsSeen,
  notifyState,
  refreshNotifications,
  unreadReplies,
} = await import("../../packages/web/src/notifications/notify.svelte");

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

const notice = (
  id: string,
  kind: NotificationRow["kind"],
  readAt: string | null = null,
): NotificationRow => ({
  id,
  kind,
  title: null,
  body_text: null,
  ref: {},
  read_at: readAt,
  seen_at: null,
  created_at: "2026-10-24T08:00:00Z",
});

describe("report replies", () => {
  it("gathers every unread reply, and nothing else", () => {
    notifyState.items = [
      notice("r1", "report_reply"),
      notice("w1", "work_item_changed"),
      notice("r2", "report_reply"),
      notice("r3", "report_reply", "2026-10-24T09:00:00Z"),
    ];
    expect(unreadReplies().map((reply) => reply.id)).toEqual(["r1", "r2"]);
  });

  it("has none once they are read", () => {
    notifyState.items = [notice("r1", "report_reply", "2026-10-24T09:00:00Z")];
    expect(unreadReplies()).toEqual([]);
  });
});

describe("seen", () => {
  it("stamps only the rows not yet seen, and leaves them unread", async () => {
    notifyState.items = [
      notice("w1", "work_item_changed"),
      { ...notice("w2", "work_item_changed"), seen_at: "2026-10-24T09:00:00Z" },
    ];
    await markNotificationsSeen();
    const [fresh, earlier] = notifyState.items;
    expect(fresh.seen_at).not.toBeNull();
    expect(fresh.read_at).toBeNull();
    expect(earlier.seen_at).toBe("2026-10-24T09:00:00Z");
    expect(api.post).toHaveBeenCalledWith("/me/notifications/seen", {});
  });

  it("keeps the local mark when the server call fails", async () => {
    notifyState.items = [notice("w1", "work_item_changed")];
    api.post.mockRejectedValueOnce(new Error("offline"));
    await markNotificationsSeen();
    expect(notifyState.items[0].seen_at).not.toBeNull();
  });
});

describe("refresh", () => {
  it("counts as loaded only once a fetch lands", async () => {
    notifyState.loaded = false;
    session.me = { email: "a@example.test" } as typeof session.me;
    api.get.mockRejectedValueOnce(new Error("offline"));
    await refreshNotifications();
    expect(notifyState.loaded).toBe(false);

    api.get.mockResolvedValueOnce([notice("w1", "work_item_changed")]);
    await refreshNotifications();
    expect(notifyState.loaded).toBe(true);
    expect(notifyState.items.map((n) => n.id)).toEqual(["w1"]);
  });
});
