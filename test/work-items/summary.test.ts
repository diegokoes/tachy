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
  files: [],
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

describe("the files of a summary", () => {
  const withFiles: TicketSummary = {
    ...summary,
    files: [
      {
        name: "screen<1>.png",
        from: "Ana",
        date: "2026-06-16",
        shows: "The spooler's error dialog, code E-209.",
      },
      { name: "app.log", shows: "Timeouts start at 10:02." },
      { name: "export.csv" },
    ],
  };

  it("get a section of their own in the note, each with who sent it and what it shows", () => {
    const html = renderSummaryHtml({ external_id: "42" }, withFiles);
    expect(html).toContain("<strong>Files</strong>");
    expect(html).toContain(
      `<strong>screen&lt;1&gt;.png</strong> <span style="color:#777">Ana, 2026-06-16</span><br>The spooler's error dialog, code E-209.`,
    );
    expect(html).toContain(
      "<strong>app.log</strong><br>Timeouts start at 10:02.",
    );
    expect(html).toContain("<strong>export.csv</strong></li>");
    expect(html.indexOf("Files")).toBeGreaterThan(
      html.indexOf("Tried / ruled out"),
    );
  });

  it("link a file's name to where it opens, given its path and a place to open it", () => {
    const linked: TicketSummary = {
      ...summary,
      files: [
        {
          name: "image.png",
          path: "attachment:fd/42/inline-7",
          shows: "The error.",
        },
        { name: "image.png", path: "attachment:fd/42/inline-8" },
        { name: "app.log", path: "attachment:other/1/9" },
        { name: "export.csv" },
      ],
    };
    const linkOf = (path: string) =>
      path.startsWith("attachment:fd/42/")
        ? `https://tachy.test/open?a=1&f=${path.slice(17)}`
        : null;
    const html = renderSummaryHtml({ external_id: "42" }, linked, linkOf);
    expect(html).toContain(
      `<strong><a href="https://tachy.test/open?a=1&amp;f=inline-7" target="_blank" rel="noopener noreferrer">image.png</a></strong><br>The error.`,
    );
    // Two files of one name are told apart by where each leads.
    expect(html).toContain(`f=inline-8" target="_blank"`);
    expect(html).toContain("<strong>app.log</strong>");
    expect(html).toContain("<strong>export.csv</strong>");
    expect(renderSummaryHtml({ external_id: "42" }, linked)).not.toContain(
      "<a ",
    );
    expect(renderSummaryText(linked)).not.toContain("attachment:");
  });

  it("are lines of the text a later flow step reads", () => {
    expect(renderSummaryText(withFiles).split("\n").slice(-4)).toEqual([
      "Files:",
      "- screen<1>.png (Ana, 2026-06-16): The spooler's error dialog, code E-209.",
      "- app.log: Timeouts start at 10:02.",
      "- export.csv",
    ]);
  });

  it("leave no section behind when there are none, or the summary names none", () => {
    const { files: _none, ...older } = withFiles;
    for (const bare of [older, { ...older, files: [] }]) {
      expect(renderSummaryHtml({ external_id: "42" }, bare)).not.toContain(
        "Files",
      );
      expect(renderSummaryText(bare)).not.toContain("Files:");
    }
    expect(ticketSummarySchema.parse(older).files).toEqual([]);
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
