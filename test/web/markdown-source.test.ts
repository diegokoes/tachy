/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderMarkdown } from "../../packages/web/src/markdown/markdown";
import {
  shownSelection,
  sourceSpan,
} from "../../packages/web/src/markdown/source";

/** The markdown rendered into the page, the way an entry section shows it. */
function rendered(source: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source);
  document.body.append(root);
  return root;
}

/** The text node of `root` holding `needle`. */
function textHolding(root: Node, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if ((node as Text).data.includes(needle)) return node as Text;
  throw new Error(`no text holds ${needle}`);
}

function select(start: [Node, number], end: [Node, number] = start) {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

/** The source under the rendered words `needle` once they are selected. */
function sourceUnder(source: string, needle: string): string {
  const root = rendered(source);
  const node = textHolding(root, needle);
  const at = node.data.indexOf(needle);
  const picked = shownSelection(
    root,
    select([node, at], [node, at + needle.length]),
  );
  const span = sourceSpan(source, picked!);
  return source.slice(span.start, span.end);
}

/** The source from a caret put down just before the rendered `needle`. */
function sourceAfterCaret(source: string, needle: string): string {
  const root = rendered(source);
  const node = textHolding(root, needle);
  const picked = shownSelection(
    root,
    select([node, node.data.indexOf(needle)]),
  );
  return source.slice(sourceSpan(source, picked!).start);
}

afterEach(() => document.body.replaceChildren());

describe("a selection on rendered markdown, in its source", () => {
  it("covers the same words in plain text", () => {
    expect(sourceUnder("the line stops at E493", "stops at")).toBe("stops at");
  });

  it("passes over emphasis and code marks", () => {
    expect(sourceUnder("a **bold** move", "bold")).toBe("bold");
    expect(sourceUnder("set `retries` to 3", "retries")).toBe("retries");
  });

  it("passes over list numbers and a link's address", () => {
    const steps = "1. Reproduced it.\n2. Checked the logs.";
    expect(sourceUnder(steps, "Checked")).toBe("Checked");
    expect(sourceAfterCaret(steps, "Checked")).toBe("Checked the logs.");
    const linked = "see [the docs](https://example.com/setup) then retry";
    expect(sourceUnder(linked, "then")).toBe("then");
  });

  it("reads a callout's title in any case, so its body still pairs up", () => {
    expect(sourceUnder("> [!tip]\n> Try a restart", "Try")).toBe("Try");
  });

  it("pairs a character the source lacks with nothing", () => {
    expect(sourceUnder("a &copy; b", "b")).toBe("b");
  });
});

describe("a caret on rendered markdown, in its source", () => {
  it("stays on its line at a line's end", () => {
    const source = "first line\nsecond line";
    const root = rendered(source);
    const first = textHolding(root, "first");
    const ending = shownSelection(root, select([first, first.length]))!;
    expect(ending.trailing).toBe(true);
    expect(sourceSpan(source, ending)).toEqual({ start: 10, end: 10 });

    const second = textHolding(root, "second");
    const starting = shownSelection(root, select([second, 0]))!;
    expect(starting.trailing).toBe(false);
    expect(sourceSpan(source, starting)).toEqual({ start: 11, end: 11 });
  });

  it("goes to the end when nothing follows it", () => {
    const picked = { shown: "done", start: 4, end: 4, trailing: false };
    expect(sourceSpan("**done**", picked)).toEqual({ start: 6, end: 6 });
  });

  it("goes to the start when nothing pairs before it", () => {
    const picked = { shown: "©", start: 1, end: 1, trailing: true };
    expect(sourceSpan("&copy;", picked)).toEqual({ start: 0, end: 0 });
  });
});

describe("the selection inside rendered text", () => {
  it("counts the characters before each end", () => {
    const root = rendered("the **line** stops");
    const bold = textHolding(root, "line");
    expect(shownSelection(root, select([bold, 0], [bold, 4]))).toMatchObject({
      start: 4,
      end: 8,
      trailing: false,
    });
  });

  it("is cut at the root's edges when a drag runs past them", () => {
    const heading = document.createElement("p");
    heading.textContent = "heading";
    document.body.append(heading);
    const root = rendered("one two");
    const next = document.createElement("p");
    next.textContent = "next section";
    document.body.append(next);
    const text = textHolding(root, "two");

    const down = shownSelection(root, select([text, 4], [next.firstChild!, 4]));
    expect(down).toMatchObject({ start: 4, end: down!.shown.length });
    const up = shownSelection(
      root,
      select([heading.firstChild!, 2], [text, 3]),
    );
    expect(up).toMatchObject({ start: 0, end: 3 });
  });

  it("is null without a selection, or with one elsewhere", () => {
    const root = rendered("one two");
    expect(shownSelection(root, null)).toBeNull();
    document.getSelection()!.removeAllRanges();
    expect(shownSelection(root, document.getSelection())).toBeNull();
    const other = document.createElement("p");
    other.textContent = "elsewhere";
    document.body.append(other);
    expect(shownSelection(root, select([other.firstChild!, 2]))).toBeNull();
  });
});
