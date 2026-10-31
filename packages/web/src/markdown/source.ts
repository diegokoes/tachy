/**
 * Rendered markdown read back to its source, so a click or a selection on the
 * rendered text lands on the same place, or the same words, in the markdown.
 */

/** A selection on rendered text, as offsets into `shown`. */
export interface ShownSelection {
  shown: string;
  start: number;
  end: number;
  /** A caret at the end of a run of text, such as before a line break. */
  trailing: boolean;
}

export interface SourceSpan {
  start: number;
  end: number;
}

const isSpace = (ch: string) => /\s/.test(ch);

const alike = (shownChar: string, sourceChar: string) =>
  isSpace(shownChar)
    ? isSpace(sourceChar)
    : shownChar.toLowerCase() === sourceChar.toLowerCase();

/**
 * The source index of each rendered character, -1 for one the source lacks,
 * such as an entity's character. Rendered text is the source less its markup,
 * so each character pairs with the next like one in the source.
 */
function pairUp(source: string, shown: string): number[] {
  const indexes: number[] = [];
  let from = 0;
  for (let i = 0; i < shown.length; i++) {
    let at = from;
    while (at < source.length && !alike(shown[i], source[at])) at++;
    if (at === source.length) {
      indexes.push(-1);
      continue;
    }
    indexes.push(at);
    from = at + 1;
  }
  return indexes;
}

/**
 * Where a selection on rendered markdown falls in its source. A caret goes
 * before the character it stands in front of, or, when `trailing`, after the
 * one it follows, which keeps a caret at a line's end on that line.
 */
export function sourceSpan(source: string, picked: ShownSelection): SourceSpan {
  const indexes = pairUp(source, picked.shown);
  const after = (offset: number) => {
    for (let i = Math.min(offset, indexes.length) - 1; i >= 0; i--)
      if (indexes[i] >= 0) return indexes[i] + 1;
    return 0;
  };
  const before = (offset: number) => {
    for (let i = offset; i < indexes.length; i++)
      if (indexes[i] >= 0) return indexes[i];
    return after(offset);
  };
  if (picked.start === picked.end) {
    const caret = picked.trailing ? after(picked.end) : before(picked.start);
    return { start: caret, end: caret };
  }
  const start = before(picked.start);
  return { start, end: Math.max(start, after(picked.end)) };
}

/**
 * The selection inside `root`, counted the way `Range.toString` counts text;
 * an end beyond `root` is cut at its edge. Null when it does not reach `root`.
 */
export function shownSelection(
  root: Node,
  selection: Selection | null,
): ShownSelection | null {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;
  const doc = root.ownerDocument ?? document;
  const whole = doc.createRange();
  whole.selectNodeContents(root);
  const shown = whole.toString();
  const offsetOf = (node: Node, offset: number) => {
    const side = whole.comparePoint(node, offset);
    if (side !== 0) return side < 0 ? 0 : shown.length;
    const before = doc.createRange();
    before.setStart(root, 0);
    before.setEnd(node, offset);
    return before.toString().length;
  };
  const end = range.endContainer;
  return {
    shown,
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(end, range.endOffset),
    trailing:
      range.collapsed &&
      end.nodeType === Node.TEXT_NODE &&
      range.endOffset === (end as Text).length,
  };
}
