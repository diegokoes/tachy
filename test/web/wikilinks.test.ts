/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

const navigated: string[] = [];
vi.mock("../../packages/web/src/lib/router.svelte", () => ({
  navigate: (to: string) => navigated.push(to),
}));

const { LinkTargets } =
  await import("../../packages/web/src/lib/wikilinks.svelte");

/**
 * The anchors carry no href — the route is only known once the server has
 * resolved the target — so the delegated handlers are the whole of how a
 * wikilink is followed. A pointer-only version of that is a wiki no keyboard
 * user can navigate.
 */
function anchorIn(html: string): HTMLElement {
  document.body.innerHTML = `<div>${html}</div>`;
  return document.querySelector("a[data-wikilink]") as HTMLElement;
}

describe("following a wikilink", () => {
  const withTarget = (target: string, to: string) => {
    const links = new LinkTargets();
    (links as unknown as { to: Map<string, string> }).to.set(target, to);
    return links;
  };

  it("follows on Enter and on Space, not on any other key", () => {
    navigated.length = 0;
    const links = withTarget("spooler", "/library/wiki/tpd/spooler");
    const a = anchorIn(
      '<a role="link" tabindex="0" data-wikilink="spooler">x</a>',
    );

    for (const key of ["Enter", " "]) {
      const e = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      a.dispatchEvent(e);
      links.onKeydown(e);
    }
    expect(navigated).toEqual([
      "/library/wiki/tpd/spooler",
      "/library/wiki/tpd/spooler",
    ]);

    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    Object.defineProperty(tab, "target", { value: a });
    links.onKeydown(tab);
    expect(navigated).toHaveLength(2);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("ignores a key pressed anywhere that is not a wikilink", () => {
    navigated.length = 0;
    const links = withTarget("spooler", "/somewhere");
    document.body.innerHTML = "<p>plain text</p>";
    const e = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    Object.defineProperty(e, "target", { value: document.querySelector("p") });
    links.onKeydown(e);
    expect(navigated).toEqual([]);
  });

  it("does not navigate for a target the server did not resolve", () => {
    navigated.length = 0;
    const links = withTarget("spooler", "/somewhere");
    const a = anchorIn(
      '<a role="link" tabindex="0" data-wikilink="unknown">x</a>',
    );
    const e = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    a.dispatchEvent(e);
    links.onKeydown(e);
    expect(navigated).toEqual([]);
    // Still swallowed, so Space does not scroll the page under the reader.
    expect(e.defaultPrevented).toBe(true);
  });
});
