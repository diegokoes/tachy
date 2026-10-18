import { beforeEach, describe, expect, it } from "vitest";
import {
  addEntry,
  canRestore,
  chat,
  clearChat,
  forgetCleared,
  restoreChat,
} from "../../packages/web/src/chat/chatState.svelte";
import {
  canClear,
  clearConversation,
  restoreConversation,
} from "../../packages/web/src/chat/clearing";
import { notifyState } from "../../packages/web/src/notifications/notify.svelte";
import { topbar } from "../../packages/web/src/shell/topbar.svelte";

describe("clearing the conversation", () => {
  beforeEach(() => {
    forgetCleared();
    chat.entries = [];
    addEntry({ kind: "user", text: "why is the export empty?" });
    addEntry({ kind: "assistant", text: "The filter drops every row." });
    chat.sessionId = "s1";
    chat.mode = "analyze";
    chat.debug = true;
  });

  it("empties it at once and keeps nothing behind", () => {
    clearChat();
    expect(chat.entries).toEqual([]);
    expect(chat.sessionId).toBeUndefined();
    expect(chat.mode).toBeUndefined();
    expect(chat.debug).toBe(false);
    expect(canRestore()).toBe(true);
  });

  it("brings back what the clear took, once", () => {
    clearChat();
    restoreChat();
    expect(chat.entries.map((e) => e.kind)).toEqual(["user", "assistant"]);
    expect(chat.sessionId).toBe("s1");
    expect(chat.mode).toBe("analyze");
    expect(chat.debug).toBe(true);
    expect(canRestore()).toBe(false);
  });

  it("has nothing to bring back once a new turn starts", () => {
    clearChat();
    forgetCleared();
    restoreChat();
    expect(chat.entries).toEqual([]);
    expect(canRestore()).toBe(false);
  });
});

describe("clearing from the chat or the palette", () => {
  beforeEach(() => {
    forgetCleared();
    chat.entries = [];
    chat.busy = false;
    notifyState.toasts = [];
    topbar.tucked = false;
    topbar.veiled = false;
    addEntry({ kind: "user", text: "why is the export empty?" });
  });

  it("offers the conversation back, and takes the offer down with it", () => {
    clearConversation();
    expect(chat.entries).toEqual([]);
    expect(notifyState.toasts).toHaveLength(1);
    restoreConversation();
    expect(chat.entries).toHaveLength(1);
    expect(notifyState.toasts).toHaveLength(0);
  });

  it("leaves a turn under way alone", () => {
    chat.busy = true;
    expect(canClear()).toBe(false);
    clearConversation();
    expect(chat.entries).toHaveLength(1);
  });

  // Off screen the bar was never tucked, and nothing would show it again.
  it("veils the bar only while the conversation holds its row", () => {
    clearConversation();
    expect(topbar.veiled).toBe(false);
    restoreConversation();
    topbar.tucked = true;
    clearConversation();
    expect(topbar.veiled).toBe(true);
  });
});
