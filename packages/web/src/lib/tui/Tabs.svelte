<script lang="ts">
  import { pushScope } from "../keys.svelte";
  import { subnavKey } from "../keys/bindings.svelte";
  import { vimState } from "../vim.svelte";
  import { jellyPress } from "../motion";

  type Item = { key: string; label: string };

  let {
    items,
    active,
    onpick,
    hotkeys = "none",
    anchor = "--tab-bar",
  }: {
    items: Item[];
    active: string;
    onpick: (key: string) => void;
    /** "shift" claims ⇧1..⇧9 here; the plain digits belong to the tab bar. */
    hotkeys?: "none" | "shift";
    /**
     * This bar's anchor name. Two bars in one document must not share one:
     * duplicate anchor names resolve to the last element in tree order, so the
     * subnav's active tab would capture the nav's indicator too.
     */
    anchor?: string;
  } = $props();

  function step(delta: number) {
    const i = items.findIndex((it) => it.key === active);
    const next = items[Math.min(items.length - 1, Math.max(0, i + delta))];
    if (next && next.key !== active) onpick(next.key);
  }

  // hidden: there is no longer a digit rendered to repeat, and Settings ›
  // keybinds is where these are listed now.
  $effect(() => {
    if (hotkeys !== "shift") return;
    const pick = onpick;
    return pushScope([
      ...items.slice(0, 9).map((it, i) => ({
        key: subnavKey(i),
        label: it.label,
        hidden: true,
        run: () => pick(it.key),
      })),
      ...(vimState.enabled
        ? [
            { key: "shift+h", label: "", hidden: true, run: () => step(-1) },
            { key: "shift+l", label: "", hidden: true, run: () => step(1) },
          ]
        : []),
    ]);
  });
</script>

<nav class="tabs" style="--tab-anchor: {anchor}">
  {#each items as it}
    {@const on = it.key === active}
    <button
      class="tab"
      class:on
      aria-current={on ? "page" : undefined}
      onclick={(e) => {
        onpick(it.key);
        // A pointer click (detail > 0) leaves the button focused but not
        // :focus-visible — until an unrelated later keypress makes Chrome
        // upgrade that stale focus, stealing the anchored indicator from
        // whichever tab is actually active. Blurring after a pointer click
        // avoids that; a keyboard-activated click (detail === 0) keeps focus
        // so the ring still shows where it legitimately belongs.
        if (e.detail !== 0) e.currentTarget.blur();
      }}
      use:jellyPress
    >
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span>{it.label}<span
          class="br"
          aria-hidden="true">]</span
        ></span
      >
    </button>
  {/each}

  <span class="rule" aria-hidden="true"></span>
</nav>

<style>
  /* btop's options-menu bar: the active tab is bracketed and a rule runs out to
     fill the remaining width. The brackets are always laid out and only toggled
     with visibility, so a tab keeps the same width whether or not it is the
     active one — the row never reflows when you switch section.

     The accent-colored hotkey digits that used to ride here are gone. The keys
     still work; Settings › keybinds is what advertises them.

     isolate, so the indicator below can sit at z-index -1: behind the labels,
     but still in front of whatever surface the bar is drawn on.

     The space between tabs is each tab's own padding rather than a flex gap:
     a gap is dead ground the pointer crosses, and the indicator collapsed and
     re-expanded on every crossing. Tiling the buttons edge to edge means
     moving along the bar is one continuous hover. The label-to-label distance
     is within a hair of what the gap gave. */
  .tabs {
    display: flex;
    align-items: center;
    gap: 0;
    min-width: 0;
    isolation: isolate;

    /* One overshoot, then land. Named once because the slide reads as one
       motion whether it is the left edge or the right one arriving.

       This is a damped-spring curve cut at the point it first crosses back
       through 1 — 55.8% of the way along — and re-timed to end there. Run
       past that point it dips to 0.99 and then creeps back up over the whole
       remaining 40%, which reads as a second, slower bounce arriving after
       the element has visibly already stopped. */
    --tab-spring: linear(
      0,
      0.008 2%,
      0.031 3.9%,
      0.129 8.6%,
      0.257 12.9%,
      0.671 25.4%,
      0.789 29.6%,
      0.881 33.3%,
      0.957 37.1%,
      1.019 41%,
      1.063 45%,
      1.094 49.1%,
      1.114 55%,
      1.112 61.8%,
      1.018 89.4%,
      1
    );
  }

  .tab {
    display: inline-flex;
    align-items: baseline;
    gap: 0.1em;
    font: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    color: var(--muted);
    padding: var(--pad-1) var(--pad-3);
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.on {
    color: var(--accent);
  }
  .tab:focus-visible {
    outline: none;
    border-color: transparent;
    box-shadow: none;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .br {
    visibility: hidden;
  }
  .tab.on .br {
    visibility: visible;
  }

  .rule {
    flex: 1;
    min-width: 1ch;
    height: 0;
    align-self: center;
    border-top: var(--panel-line);
    margin: 0 var(--pad-2);
  }

  /* One rule under the active tab, anchored to it rather than drawn inside it,
     so it slides between tabs instead of blinking from one to the next — and
     grows into a block behind whichever tab the pointer or keyboard is on.

     The anchor is the label, not the button: a button is label plus the
     padding that separates it from its neighbour, and an underline drawn to
     that width reads as belonging to the row rather than to the word. The
     block form adds its own padding back.

     Deliberately no `position: relative` on .tabs or .tab: the indicator's
     containing block is the surface the bar sits on — the nav's Panel, the
     subnav's own box — and the anchor only has to be a descendant of that. */
  .tab.on .lbl,
  .tab:hover .lbl,
  .tab:focus-visible .lbl {
    anchor-name: var(--tab-anchor);
  }

  /* The active tab gives the name up while a tab is being pointed at, so
     exactly one element ever holds it. Without this, hovering a tab that sits
     BEFORE the active one does nothing: duplicate names resolve to the last in
     tree order, not the nearest. */
  .tabs:has(.tab:is(:hover, :focus-visible))
    .tab.on:not(:hover, :focus-visible)
    .lbl {
    anchor-name: none;
  }

  @supports (anchor-name: --a) {
    /* An inset resolved off anchor() is measured from that inset's own edge,
       so subtracting always grows the box outward and adding always pulls it
       in — top and bottom move in opposite directions for the same sign. The
       underline is --panel-line-w thick, sitting --pad-1 clear of the
       descenders. */
    .tabs::before {
      content: "";
      position: absolute;
      position-anchor: var(--tab-anchor);
      z-index: -1;
      pointer-events: none;
      left: anchor(left);
      right: anchor(right);
      top: calc(anchor(bottom) + var(--pad-1));
      bottom: calc(anchor(bottom) - var(--pad-1) - var(--panel-line-w));
      background: var(--accent);
      border-radius: 0;
      /* The bounce is horizontal only. Overshoot on the vertical edges makes
         the underline-to-block growth wobble instead of land — top and bottom
         each fly past their mark and spring back, and the two crossing is the
         shake. They get a plain ease and are done before the slide is. */
      transition:
        left 320ms var(--tab-spring),
        right 320ms var(--tab-spring),
        top 180ms ease-out,
        bottom 180ms ease-out,
        background-color 200ms ease,
        border-radius 200ms ease,
        opacity 200ms ease;
    }

    /* Underline to block. The anchor name does not change here, only which
       edges are read off it, so the insets interpolate. */
    .tabs:has(.tab:is(:hover, :focus-visible))::before {
      left: calc(anchor(left) - var(--pad-2));
      right: calc(anchor(right) - var(--pad-2));
      top: calc(anchor(top) - var(--pad-1));
      bottom: calc(anchor(bottom) - var(--pad-1));
      background: var(--accent-dim);
      border-radius: var(--radius-control);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tabs::before {
      transition: none;
    }
  }
</style>
