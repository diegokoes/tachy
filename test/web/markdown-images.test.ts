/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../packages/web/src/lib/markdown";

/**
 * The renderer only ever sees markdown images. A raw <img> in a body goes
 * through marked untouched, so the sanitizer's own pass is the second half of
 * the rule, and it needs a DOM to run.
 */
describe("images in a rendered body", () => {
  const asset = "/api/library/assets/0b6a8f5e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

  it("keeps the library's own image", () => {
    const out = renderMarkdown(`![sketch](${asset})`);
    expect(out).toContain(`<img src="${asset}"`);
    expect(out).toContain('loading="lazy"');
  });

  it("strips a raw img pointing anywhere else", () => {
    const out = renderMarkdown(
      'before <img src="https://example.invalid/t.png?d=x"> after',
    );
    expect(out).not.toContain("<img");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips a raw img with no source, or a data: one", () => {
    expect(renderMarkdown("<img alt=x>")).not.toContain("<img");
    expect(
      renderMarkdown('<img src="data:image/png;base64,AAAA">'),
    ).not.toContain("<img");
  });

  it("keeps a raw img that is one of ours", () => {
    expect(renderMarkdown(`<img src="${asset}" alt="ok">`)).toContain(
      `src="${asset}"`,
    );
  });

  /** The hook is added per call; one left behind would run on every sanitize. */
  it("leaves no hook installed between renders", () => {
    renderMarkdown(`![a](${asset})`);
    renderMarkdown(`![b](${asset})`);
    expect(renderMarkdown(`![c](${asset})`).match(/<img/g)).toHaveLength(1);
  });
});
