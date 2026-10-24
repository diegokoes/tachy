import { describe, expect, it } from "vitest";
import type { NotificationRow } from "@tachy/contract";
import {
  notifyState,
  unreadReplies,
} from "../../packages/web/src/notifications/notify.svelte";

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
