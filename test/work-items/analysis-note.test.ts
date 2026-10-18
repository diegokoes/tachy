import { describe, expect, it } from "vitest";
import {
  NOTE_MARKER,
  renderAnalysisNote,
  type CitedCode,
} from "@tachy/core/work-items";

const reconnect: CitedCode = {
  repo: "platform-sync",
  path: "src/sync/reconnect.ts",
  commit: "4f9c2e1a7d3b0c86e5f1a2b4c6d8e0f1a3b5c7d9",
  startLine: 49,
  endLine: 50,
  url: "https://dev.azure.com/org/Platform/_git/platform-sync?path=%2Fsrc%2Fsync%2Freconnect.ts&line=49",
  excerpt:
    "49  const token = await this.refreshToken(session);\n50  this.pool.reset();",
};

const pool: CitedCode = {
  ...reconnect,
  path: "src/sync/pool.ts",
  startLine: 12,
  endLine: 12,
  url: null,
  excerpt: "12  sessions.clear();",
};

const render = (body: string, code: CitedCode[] = [reconnect]) =>
  renderAnalysisNote({
    externalId: "48213",
    title: "Why the <controllers> lose their token",
    body,
    code,
    requestedBy: "Ana Ruiz in chat",
    caveat: "Written by a model in a chat with Ana Ruiz.",
  });

describe("renderAnalysisNote", () => {
  it("frames the text as an analysis note, keeping its paragraphs and bold", () => {
    const html = render("The <b>refresh</b> runs first.\n\nThen it fails.", []);
    expect(html).toContain(
      ">Analysis</span><strong>Why the &lt;controllers&gt; lose their token</strong>",
    );
    expect(html).toContain(">Ana Ruiz in chat</td>");
    expect(html).toContain(
      '<p style="margin:0 0 8px 0">The <b>refresh</b> runs first.</p>',
    );
    expect(html).toContain('<p style="margin:0 0 8px 0">Then it fails.</p>');
    expect(html).toContain("Written by a model in a chat with Ana Ruiz.");
    expect(html).toContain(NOTE_MARKER);
  });

  it("links a citation where the text makes it, and quotes the lines after that paragraph", () => {
    const html = render(
      "The pool reset [[1]] closes the session.\n\nSo the next sync gets a 401.",
    );
    expect(html).toContain(
      `The pool reset <a href="${reconnect.url!.replace(/&/g, "&amp;")}" target="_blank" rel="noopener noreferrer">reconnect.ts, lines 49–50</a> closes the session.`,
    );
    const quote = html.indexOf("this.pool.reset();");
    expect(quote).toBeGreaterThan(html.indexOf("closes the session."));
    expect(quote).toBeLessThan(html.indexOf("So the next sync"));
    expect(html).toContain("platform-sync: src/sync/reconnect.ts @ 4f9c2e1");
  });

  it("quotes a range once however often it is cited", () => {
    const html = render("First [[1]].\n\nAgain [[1]].");
    expect(html.match(/this\.pool\.reset\(\);/g)).toHaveLength(1);
    expect(html.match(/reconnect\.ts, lines 49–50/g)).toHaveLength(2);
  });

  it("names a range it cannot link by path, line and commit", () => {
    const html = render("Cleared here [[1]].", [pool]);
    expect(html).toContain("<code>src/sync/pool.ts line 12 @ 4f9c2e1</code>");
    expect(html).not.toContain("<a href");
  });

  it("closes with the code the text never cites, and drops a citation with no code", () => {
    const html = render("Cited [[1]], not [[3]], here.", [reconnect, pool]);
    expect(html).toContain("Cited <a href=");
    expect(html).toContain("</a>, not, here.");
    expect(html).not.toContain("[[3]]");
    expect(html).toContain(">Code</p>");
    expect(html.indexOf("sessions.clear();")).toBeGreaterThan(
      html.indexOf(">Code</p>"),
    );
  });
});
