import { beforeEach, describe, expect, it } from "vitest";
import {
  addEntry,
  canRestore,
  chat,
  clearChat,
  forgetCleared,
  restoreChat,
} from "../../packages/web/src/chat/chatState.svelte";

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
