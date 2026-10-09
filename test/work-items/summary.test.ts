import { describe, expect, it, vi } from "vitest";
import {
  SUMMARY_MARKER,
  asNoteHtml,
  packBlocks,
  priorSummaryIds,
  renderSummaryHtml,
  renderSummaryText,
  replaceNotes,
  textToHtml,
  ticketSummarySchema,
  type TicketSummary,
} from "@tachy/core/work-items";
import { type RawMessage } from "@tachy/core/sources";

const summary: TicketSummary = {
  problem: "Line 3 stops printing mid-batch since the <2.4> upgrade.",
  status: "Waiting on the customer to confirm the spooler patch.",
  timeline: [
    { date: "2026-06-16", who: "Ana", event: "Reported the stoppage." },
    { date: "2026-06-18", event: "Patch delivered." },
  ],
  tried: [{ action: "Restarted the spooler", outcome: "No change." }],
};

const note = (over: Partial<RawMessage>): RawMessage => ({
  visibility: "private",
  direction: "outgoing",
  bodyText: "",
  ...over,
});

describe("renderSummaryHtml", () => {
  const html = renderSummaryHtml({ external_id: "42", title: "T&T" }, summary);

  it("lays the summary out in its sections and stamps the marker", () => {
    expect(html).toContain("<strong>Summary</strong> - T&amp;T");
    for (const heading of [
      "Problem",
      "Current status",
      "Timeline",
      "Tried / ruled out",
    ])
      expect(html).toContain(`<strong>${heading}</strong>`);
    expect(html).toContain("<strong>Ana</strong>: Reported the stoppage.");
    expect(html).toContain(SUMMARY_MARKER);
  });

  it("escapes what the model wrote", () => {
    expect(html).toContain("&lt;2.4&gt;");
    expect(html).not.toContain("<2.4>");
  });

  it("drops a section that has nothing in it", () => {
    const bare = renderSummaryHtml(
      { external_id: "42" },
      { ...summary, timeline: [], tried: [] },
    );
    expect(bare).not.toContain("Timeline");
    expect(bare).not.toContain("Tried / ruled out");
  });
});

describe("renderSummaryText", () => {
  it("is the same content as lines a later flow step can read", () => {
    expect(renderSummaryText(summary)).toBe(
      [
        "Problem: Line 3 stops printing mid-batch since the <2.4> upgrade.",
        "Status: Waiting on the customer to confirm the spooler patch.",
        "Timeline:",
        "- 2026-06-16 Ana: Reported the stoppage.",
        "- 2026-06-18: Patch delivered.",
        "Tried / ruled out:",
        "- Restarted the spooler -> No change.",
      ].join("\n"),
    );
    expect(
      renderSummaryText({ ...summary, timeline: [], tried: [] }).split("\n"),
    ).toHaveLength(2);
  });
});

describe("ticketSummarySchema", () => {
  it("refuses a summary with no problem statement", () => {
    expect(
      ticketSummarySchema.safeParse({ ...summary, problem: "" }).success,
    ).toBe(false);
    expect(ticketSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe("priorSummaryIds", () => {
  it("names the notes that carry the marker, and only those with an id", () => {
    expect(
      priorSummaryIds([
        note({ externalId: "1", bodyText: "an ordinary note" }),
        note({ externalId: "2", bodyText: `Summary ... ${SUMMARY_MARKER}` }),
        note({ bodyText: `no id ${SUMMARY_MARKER}` }),
      ]),
    ).toEqual(["2"]);
  });
});

describe("replaceNotes", () => {
  it("posts every body before it deletes an earlier note", async () => {
    const calls: string[] = [];
    const posted = await replaceNotes(
      {
        postNote: async (_id, body) => void calls.push(`post ${body}`),
        deleteNote: async (id) => void calls.push(`delete ${id}`),
      },
      "42",
      ["a", "b"],
      ["old"],
    );
    expect(calls).toEqual(["post a", "post b", "delete old"]);
    expect(posted).toEqual({ notes: 2, replaced_previous: 1 });
  });

  it("leaves a note it cannot delete and does not count it", async () => {
    const posted = await replaceNotes(
      {
        postNote: async () => {},
        deleteNote: vi.fn().mockRejectedValue(new Error("gone")),
      },
      "42",
      ["a"],
      ["old"],
    );
    expect(posted).toEqual({ notes: 1 });
  });

  it("posts without deleting on a source that cannot delete", async () => {
    const postNote = vi.fn().mockResolvedValue(undefined);
    expect(await replaceNotes({ postNote }, "42", ["a"], ["old"])).toEqual({
      notes: 1,
    });
    expect(postNote).toHaveBeenCalledWith("42", "a", { private: true });
  });

  it("refuses a source that takes no notes", async () => {
    await expect(replaceNotes({}, "42", ["a"], [])).rejects.toThrow(
      /does not support notes/,
    );
  });
});

describe("textToHtml", () => {
  it("turns blank lines into paragraphs and single breaks into line breaks", () => {
    expect(textToHtml("one\ntwo\n\nthree")).toBe(
      '<p style="margin:0 0 8px 0">one<br>two</p><p style="margin:0 0 8px 0">three</p>',
    );
  });

  it("keeps an indented block in fixed width", () => {
    expect(textToHtml("    at a (b.ts:1)\n    at c (d.ts:2)")).toMatch(
      /^<pre [^>]*>    at a \(b\.ts:1\)\n    at c \(d\.ts:2\)<\/pre>$/,
    );
  });

  it("mutes an image placeholder and does not link past a quote", () => {
    const html = textToHtml('see [image] at "https://example.invalid/x"');
    expect(html).toContain('<span style="color:#999">[image]</span>');
    expect(html).toContain('<a href="https://example.invalid/x">');
  });
});

describe("asNoteHtml", () => {
  it("formats plain text and passes markup through", () => {
    expect(asNoteHtml("<p>ready</p>")).toBe("<p>ready</p>");
    expect(asNoteHtml("a\n\n- b")).toBe(
      '<div><p style="margin:0 0 8px 0">a</p><ul style="margin:0 0 8px 0;padding-left:22px"><li>b</li></ul></div>',
    );
  });
});

describe("packBlocks", () => {
  it("never cuts a block, even one larger than the limit", () => {
    expect(packBlocks(["aa", "bb", "cccccccc", "d"], 5)).toEqual([
      ["aa", "bb"],
      ["cccccccc"],
      ["d"],
    ]);
    expect(packBlocks([], 5)).toEqual([]);
  });
});
