import { describe, expect, it } from "vitest";
import type {
  StoredItemEvent,
  StoredItemMessage,
  StoredItemRow,
} from "@tachy/contract";
import {
  eventLine,
  itemFacts,
  senderOf,
  storedListPath,
} from "../../packages/web/src/work-items/stored";

const event = (over: Partial<StoredItemEvent>): StoredItemEvent => ({
  kind: "event",
  id: "e1",
  at: "2026-04-01T10:00:00.000Z",
  actor: null,
  field: "status",
  old_value: null,
  new_value: null,
  origin: "source",
  ...over,
});

describe("storedListPath", () => {
  it("asks for everything when nothing narrows", () => {
    expect(storedListPath({ query: " ", connection: "" }, 0)).toBe(
      "/work-items/stored",
    );
  });

  it("carries the words, the source and where the next page starts", () => {
    expect(
      storedListPath({ query: " label skew ", connection: "eng-ado" }, 100),
    ).toBe("/work-items/stored?q=label+skew&connection=eng-ado&offset=100");
  });
});

describe("eventLine", () => {
  it("reads a change of value as from and to", () => {
    expect(eventLine(event({ old_value: "2", new_value: "4" }))).toBe(
      "status 2 → 4",
    );
    expect(eventLine(event({ field: "assignee", new_value: "Bob Dev" }))).toBe(
      "assignee set to Bob Dev",
    );
    expect(eventLine(event({ field: "assignee", old_value: "7" }))).toBe(
      "assignee cleared, was 7",
    );
  });

  it("reads a moment by its name alone", () => {
    expect(eventLine(event({ field: "first_responded" }))).toBe(
      "first responded",
    );
  });

  it("says a source's prose field changed, since its text was left out", () => {
    expect(eventLine(event({ field: "System.Description" }))).toBe(
      "System.Description changed",
    );
  });

  it("says which way a link went", () => {
    expect(eventLine(event({ field: "link", new_value: "Related #10" }))).toBe(
      "link added: Related #10",
    );
    expect(eventLine(event({ field: "link", old_value: "Related #10" }))).toBe(
      "link removed: Related #10",
    );
  });
});

describe("senderOf", () => {
  const message = (over: Partial<StoredItemMessage>) =>
    ({ author: null, author_label: null, ...over }) as StoredItemMessage;

  it("prefers the name a person reads to the source's account id", () => {
    expect(
      senderOf(message({ author: "42", author_label: "jane@acme.com" })),
    ).toBe("jane@acme.com");
    expect(senderOf(message({ author: "42" }))).toBe("42");
    expect(senderOf(message({}))).toBe("unknown sender");
  });
});

describe("itemFacts", () => {
  it("lists what the copy knows and skips what the source left empty", () => {
    const item = {
      connection: "support-desk",
      status: "2",
      item_type: null,
      priority: "3",
      group: null,
      assignee: null,
      requester: "42",
      customer: "acme",
      product: null,
      team: "support",
      project: null,
    } as StoredItemRow;
    expect(itemFacts(item)).toEqual([
      ["source", "support-desk"],
      ["status", "2"],
      ["priority", "3"],
      ["requester", "42"],
      ["customer", "acme"],
      ["team", "support"],
    ]);
  });
});
