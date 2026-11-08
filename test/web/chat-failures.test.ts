import { beforeEach, describe, expect, it } from "vitest";
import {
  addEntry,
  chat,
  noteFailure,
} from "../../packages/web/src/chat/chatState.svelte";

const REASON = "MCP error -32602: symptoms must be array";

const approvalOf = (id: string, status: "approved" | "denied") =>
  addEntry({
    kind: "approval",
    id,
    tool: "save_knowledge_entry",
    input: {},
    status,
  });

describe("a call its tool refused", () => {
  beforeEach(() => {
    chat.entries = [];
  });

  it("is marked in its tools row, the calls beside it left as they ran", () => {
    addEntry({
      kind: "tools",
      calls: [
        { tool: "list_products", id: "use-1" },
        { tool: "save_knowledge_entry", id: "use-2" },
      ],
    });
    noteFailure("use-2", REASON);
    expect(chat.entries[0]).toMatchObject({
      calls: [
        { tool: "list_products", id: "use-1" },
        { tool: "save_knowledge_entry", id: "use-2", failure: REASON },
      ],
    });
  });

  it("turns its approved card to failed, with the reason", () => {
    approvalOf("use-2", "approved");
    approvalOf("use-3", "approved");
    noteFailure("use-2", REASON);
    expect(chat.entries).toMatchObject([
      { id: "use-2", status: "failed", failure: REASON },
      { id: "use-3", status: "approved" },
    ]);
  });

  it("leaves a card the person denied as denied", () => {
    approvalOf("use-2", "denied");
    noteFailure("use-2", "Denied by user.");
    expect(chat.entries[0]).toMatchObject({ status: "denied" });
    expect(chat.entries[0]).not.toHaveProperty("failure");
  });
});
