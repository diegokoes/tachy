import { describe, expect, it, vi } from "vitest";
import {
  SUMMARY_MARKER,
  asNoteHtml,
  packBlocks,
  richTextToHtml,
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
  open_questions: [],
};

/** How a section's heading ends in the markup. */
const heading = (label: string) => `>${label}</p>`;

const note = (over: Partial<RawMessage>): RawMessage => ({
  visibility: "private",
  direction: "outgoing",
  bodyText: "",
  ...over,
});

describe("renderSummaryHtml", () => {
  const html = renderSummaryHtml({ external_id: "42", title: "T&T" }, summary);

  it("lays the summary out in its sections and stamps the marker", () => {
    expect(html).toContain(">Summary</span><strong>T&amp;T</strong>");
    expect(html).toContain("#42</span>");
    for (const label of ["Problem", "Where it stands", "Timeline", "Tried"])
      expect(html).toContain(heading(label));
    expect(html).toContain("<strong>Ana</strong></td>");
    expect(html).toContain("Reported the stoppage.");
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
    expect(bare).not.toContain(heading("Timeline"));
    expect(bare).not.toContain(heading("Tried"));
  });

  it("puts the state, the customer and the transcript in the strip under the banner", () => {
    const full = renderSummaryHtml(
      { external_id: "42", title: "T&T" },
      { ...summary, state: "waiting_us" },
      {
        customer: "Northwind",
        requestedBy: "Ana Ruiz in chat",
        transcript: { parts: 2, postedAt: "2026-06-17T10:00:00Z" },
      },
    );
    expect(full).toContain(">Waiting on us</span>");
    expect(full).toContain(">Northwind</div>");
    expect(full).toContain(
      'Compacted transcript <span style="color:#777">2 parts, 2026-06-17</span>',
    );
    expect(full).toContain(">Ana Ruiz in chat</td>");
    expect(html).not.toContain("Waiting on us");
    expect(html).not.toContain("Full thread");
  });

  it("boxes the next step and the open questions before the sections", () => {
    const one = renderSummaryHtml(
      { external_id: "42" },
      {
        ...summary,
        next_step: "Ask Ana for the spooler log.",
        open_questions: ["Is line 4 affected?"],
      },
    );
    expect(one).toContain(
      "<strong>Next step:</strong> Ask Ana for the spooler log.",
    );
    expect(one).toContain(
      "<strong>Open question:</strong> Is line 4 affected?",
    );
    expect(one.indexOf("Next step")).toBeLessThan(
      one.indexOf(heading("Problem")),
    );
    const two = renderSummaryHtml(
      { external_id: "42" },
      { ...summary, open_questions: ["Is line 4 affected?", "Since when?"] },
    );
    expect(two).toContain("<li>Is line 4 affected?</li><li>Since when?</li>");
  });

  it("marks each try with its result", () => {
    const tried = renderSummaryHtml(
      { external_id: "42" },
      {
        ...summary,
        tried: [
          {
            action: "Restarted",
            result: "workaround",
            outcome: "Holds a day.",
          },
          { action: "Checked the firewall", outcome: "Nothing blocked." },
        ],
      },
    );
    expect(tried).toContain(">Workaround</span>");
    expect(tried.match(/border-radius:10px/g)).toHaveLength(1);
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
    expect(html).toContain(heading("Files"));
    expect(html).toContain(
      `<strong>screen&lt;1&gt;.png</strong> <span style="color:#777">Ana, 2026-06-16</span><br>The spooler's error dialog, code E-209.`,
    );
    expect(html).toContain(
      "<strong>app.log</strong><br>Timeouts start at 10:02.",
    );
    expect(html).toContain("<strong>export.csv</strong></li>");
    expect(html.indexOf(heading("Files"))).toBeGreaterThan(
      html.indexOf(heading("Tried")),
    );
    expect(html).toContain(">Files</div>");
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
    const html = renderSummaryHtml({ external_id: "42" }, linked, { linkOf });
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

  it("carries the state, the next step, the open questions and each try's result", () => {
    const lines = renderSummaryText({
      ...summary,
      state: "blocked",
      next_step: "Wait for the vendor.",
      open_questions: ["Which firmware?"],
      tried: [
        { action: "Restarted", result: "failed", outcome: "Same error." },
      ],
    }).split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "State: Blocked",
        "Next step: Wait for the vendor.",
        "Open questions:",
        "- Which firmware?",
        "- Restarted -> Same error. (Failed)",
      ]),
    );
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

  it("keeps the paragraphs of text that holds an inline tag", () => {
    expect(asNoteHtml("The <b>token</b> is lost.\n\nNext: restart.")).toBe(
      '<div><p style="margin:0 0 8px 0">The <b>token</b> is lost.</p><p style="margin:0 0 8px 0">Next: restart.</p></div>',
    );
  });
});

describe("richTextToHtml", () => {
  it("keeps bold, italic and code, and shows any other markup as text", () => {
    const html = richTextToHtml(
      "<em>a</em> <code>b</code> <script>c</script> <a href=x>d</a>",
    );
    expect(html).toContain("<em>a</em> <code>b</code>");
    expect(html).toContain("&lt;script&gt;c&lt;/script&gt;");
    expect(html).toContain("&lt;a href=x&gt;");
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
