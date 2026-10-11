import { describe, expect, it } from "vitest";
import { stripHtml } from "@tachy/core/sources";

describe("stripHtml", () => {
  it("turns block ends into line breaks and drops the tags", () => {
    expect(
      stripHtml("<div>Printer <b>stops</b></div><p>mid-run<br>again</p>"),
    ).toBe("Printer stops \n mid-run\nagain");
  });

  it("leaves a mark where a picture stood", () => {
    expect(stripHtml('<p>see <img src="x.png" alt="shot"> here</p>')).toBe(
      "see [image] here",
    );
  });

  it("drops a script or a style with its content, however its end tag is written", () => {
    expect(
      stripHtml(
        "a<script>steal()</script >b<STYLE type='x'>p{}</style\n>c<script>x</script foo>d",
      ),
    ).toBe("a b c d");
  });

  it("decodes an entity once, so text about markup stays text", () => {
    expect(stripHtml("5 &lt; 6 &amp; 7 &gt; 6")).toBe("5 < 6 & 7 > 6");
    expect(stripHtml("write &amp;lt;b&amp;gt; for bold")).toBe(
      "write &lt;b&gt; for bold",
    );
    expect(stripHtml("&quot;it&#39;s&nbsp;fine&quot;")).toBe('"it\'s fine"');
  });
});
