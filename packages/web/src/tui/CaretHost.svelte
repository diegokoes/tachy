<script lang="ts">
  import Caret, { caretSide, type CaretSide } from "./Caret.svelte";
  import { portal } from "./portal";

  /**
   * Draws the app's caret over whichever text field has focus. A native caret
   * takes a colour and a shape and nothing else, so the field's own is made
   * transparent and this one is placed where it would be. Fields that report no
   * selection (email, number, date), password fields and anything marked
   * `data-caret="own"` keep the native caret.
   */
  type Field = HTMLInputElement | HTMLTextAreaElement;

  const TEXTUAL = new Set(["text", "search", "url", "tel"]);
  const COPIED = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "letterSpacing",
    "wordSpacing",
    "lineHeight",
    "textTransform",
    "textIndent",
    "textAlign",
    "tabSize",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ] as const;

  let x = $state(0);
  let y = $state(0);
  let size = $state(16);
  let shown = $state(false);
  let beat = $state(0);
  let side = $state<CaretSide>("bare");

  let held: Field | null = null;
  let frame = 0;
  let mirror: HTMLDivElement | undefined;
  let seen = { pos: -1, width: -1, value: "" };
  let at = { left: 0, top: 0, line: 0 };

  function drawable(el: Element | null): el is Field {
    const ok =
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && TEXTUAL.has(el.type));
    return ok && !el.readOnly && !el.disabled && el.dataset.caret !== "own";
  }

  function release() {
    if (held) held.style.caretColor = "";
    held = null;
    shown = false;
    seen = { pos: -1, width: -1, value: "" };
  }

  // The field's text laid out again in a block that can be measured: same face,
  // same padding, same wrapping, cut at the caret.
  function measure(el: Field, pos: number) {
    const computed = getComputedStyle(el);
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      Object.assign(mirror.style, {
        position: "fixed",
        top: "0",
        left: "-9999px",
        visibility: "hidden",
        pointerEvents: "none",
        boxSizing: "content-box",
      });
      document.body.append(mirror);
    }
    for (const property of COPIED) mirror.style[property] = computed[property];
    const area = el instanceof HTMLTextAreaElement;
    const pad =
      parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
    mirror.style.width = `${el.clientWidth - pad}px`;
    mirror.style.whiteSpace = area ? "pre-wrap" : "pre";
    mirror.style.overflowWrap = area ? "break-word" : "normal";

    const tail = document.createElement("span");
    tail.textContent = el.value.slice(pos) || ".";
    mirror.replaceChildren(el.value.slice(0, pos), tail);

    size = parseFloat(computed.fontSize);
    side = caretSide(el.value, pos);
    // Rects, not offsetLeft: that one rounds to a whole pixel, and padding set
    // in rem rarely is one.
    const box = mirror.getBoundingClientRect();
    const start = tail.getClientRects()[0] ?? box;
    at = {
      left: start.left - box.left,
      top: tail.offsetTop,
      line: parseFloat(computed.lineHeight) || size * 1.2,
    };
  }

  function place(el: Field) {
    const rect = el.getBoundingClientRect();
    const left = rect.left + el.clientLeft + at.left - el.scrollLeft;
    const top =
      el instanceof HTMLTextAreaElement
        ? rect.top + el.clientTop + at.top - el.scrollTop
        : rect.top + (rect.height - at.line) / 2;
    x = left;
    y = top + (at.line - size * 1.15) / 2;
    shown =
      left >= rect.left &&
      left <= rect.right &&
      top >= rect.top - 1 &&
      top + at.line <= rect.bottom + 1;
  }

  // Every frame while a field is held: the field can move under a tween, a
  // scroll or a resize with no event that says so. Only the placing is done
  // each time; the measuring waits for the text or the caret to change.
  function sync() {
    const el = document.activeElement;
    if (el !== held) {
      release();
      if (drawable(el)) {
        held = el;
        el.style.caretColor = "transparent";
      }
    }
    if (!held) return;

    const pos = held.selectionStart;
    if (pos === null || pos !== held.selectionEnd) {
      shown = false;
      return;
    }
    const value = held.value;
    const width = held.clientWidth;
    if (pos !== seen.pos || width !== seen.width || value !== seen.value) {
      seen = { pos, width, value };
      measure(held, pos);
      beat++;
    }
    place(held);
  }

  function tick() {
    sync();
    frame = held ? requestAnimationFrame(tick) : 0;
  }

  // Typing and caret moves are also followed as they happen: left to the frame
  // loop alone, the caret reached a new letter one frame after it.
  function now() {
    sync();
    if (held && !frame) frame = requestAnimationFrame(tick);
  }

  $effect(() => {
    const events = ["focusin", "input", "selectionchange"];
    for (const type of events) document.addEventListener(type, now);
    now();
    return () => {
      for (const type of events) document.removeEventListener(type, now);
      cancelAnimationFrame(frame);
      frame = 0;
      release();
      mirror?.remove();
    };
  });
</script>

{#if shown}
  <span
    class="caret"
    aria-hidden="true"
    use:portal
    style:left="{x}px"
    style:top="{y}px"
    style:font-size="{size}px"><Caret {beat} {side} /></span
  >
{/if}

<style>
  .caret {
    position: fixed;
    z-index: calc(var(--z-overlay) + 2);
    display: flex;
    width: 0;
    margin-left: -0.115em;
    color: var(--accent);
    pointer-events: none;
  }
</style>
