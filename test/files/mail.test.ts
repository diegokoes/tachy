import { describe, expect, it } from "vitest";
import { mailText } from "../../packages/core/src/files/mail";

const eml = (lines: string[]) => new TextEncoder().encode(lines.join("\r\n"));

describe("mailText", () => {
  it("reads who, when, the subject, the plain body and the attachments by name", async () => {
    const text = await mailText(
      eml([
        "From: Ana Ops <ana@example.com>",
        "To: support@example.org, Team: bo@example.org, cy@example.org;",
        "Cc: lead@example.org",
        "Date: Wed, 04 Mar 2026 05:06:00 +0000",
        "Subject: =?UTF-8?Q?Drucker_st=C3=B6rt?=",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Der Drucker h=C3=A4lt an.",
        "--b1",
        'Content-Type: text/plain; name="app.log"',
        'Content-Disposition: attachment; filename="app.log"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("ERROR timeout\n").toString("base64"),
        "--b1--",
        "",
      ]),
    );
    expect(text.split("\n\n")).toEqual([
      [
        "From: Ana Ops <ana@example.com>",
        "To: support@example.org, bo@example.org, cy@example.org",
        "Cc: lead@example.org",
        "Date: 2026-03-04T05:06:00.000Z",
        "Subject: Drucker stört",
      ].join("\n"),
      "Der Drucker hält an.",
      "Attachments: app.log (14 B, text/plain)",
    ]);
  });

  it("falls back to the HTML part as text when there is no plain one", async () => {
    const text = await mailText(
      eml([
        "From: bot@example.com",
        "Subject: Report",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<div><p>Line one</p><p>Line <b>two</b></p></div>",
      ]),
    );
    expect(text).toContain("From: bot@example.com");
    expect(text).toContain("Line one");
    expect(text).toContain("Line two");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("Attachments:");
  });
});
