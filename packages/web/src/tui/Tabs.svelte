<script lang="ts">
  import { pushScope } from "../keys/keys.svelte";
  import { subnavKey } from "../keys/bindings.svelte";
  import { vimState } from "../keys/vim.svelte";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { jellyPress } from "../motion/motion";
  import Icon from "./Icon.svelte";
  import { tick, type Component } from "svelte";
  import type { IconName } from "./icons";
  import { tip } from "./tip.svelte";

  type Item = {
    key: string;
    label: string;
    icon?: IconName;
    /** A brand logo drawn in its own colours, in place of `icon`. */
    mark?: Component<{ size?: string }>;
  };

  let {
    items,
    active,
    onpick,
    hotkeys = "none",
    anchor = "--tab-bar",
    labels = "text",
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
    /** What a tab draws. A tab with no icon shows its name whatever this says. */
    labels?: "text" | "both" | "icons";
  } = $props();

  function step(delta: number) {
    const index = items.findIndex((item) => item.key === active);
    const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
    if (next && next.key !== active) onpick(next.key);
  }

  const activeMatches = $derived(items.some((item) => item.key === active));

  let inkEl = $state<HTMLElement>();
  let inkTween: gsap.core.Timeline | undefined;
  /** The tab and item set the ink was last drawn for. */
  let drawn: { key: string; keys: string } | null = null;
  let inkBefore: DOMRect | null = null;

  const itemKeys = $derived(items.map((item) => item.key).join(" "));

  // Runs ahead of the DOM update, so the rect is the old one, mid-tween included.
  $effect.pre(() => {
    void active;
    void itemKeys;
    inkBefore = inkEl?.getBoundingClientRect() ?? null;
  });

  // A new set of items (another section's subnav) lands the ink in place.
  $effect(() => {
    const key = active;
    const keys = itemKeys;
    const from = drawn;
    drawn = { key, keys };
    if (!inkEl || !inkBefore || !from || from.key === key) return;
    inkTween?.kill();
    gsap.set(inkEl, { clearProps: "transform" });
    if (from.keys !== keys || !activeMatches || reducedMotion()) return;
    if (!items.some((item) => item.key === from.key)) return;
    inkTween = glide(inkEl, inkBefore, inkEl.getBoundingClientRect());
  });

  let blockEl = $state<HTMLElement>();
  let blockTween: gsap.core.Timeline | undefined;
  /** The tab the hover block stands on, kept after it fades so it fades in place. */
  let hoverKey = $state<string | null>(null);
  let pointerOn = $state(false);
  let focusOn = $state(false);
  const blockShown = $derived(pointerOn || focusOn);
  let leftAtMs = 0;
  /** A pointer crossing to the next tab leaves one before it enters the other. */
  const CROSSING_MS = 50;

  /** Shows the block on `key`, gliding there only from another tab. */
  function point(key: string, via: "pointer" | "focus") {
    const crossing = blockShown || performance.now() - leftAtMs < CROSSING_MS;
    const from =
      crossing && blockEl && hoverKey !== key
        ? blockEl.getBoundingClientRect()
        : null;
    hoverKey = key;
    if (via === "pointer") pointerOn = true;
    else focusOn = true;
    blockTween?.kill();
    if (blockEl) gsap.set(blockEl, { clearProps: "transform" });
    if (!from || reducedMotion()) return;
    void tick().then(() => {
      if (blockEl)
        blockTween = glide(blockEl, from, blockEl.getBoundingClientRect());
    });
  }

  function unpoint(via: "pointer" | "focus") {
    if (via === "pointer") pointerOn = false;
    else focusOn = false;
    leftAtMs = performance.now();
  }

  /** Tweens `el` from `from` to where it is laid out, leading edge first. */
  function glide(el: HTMLElement, from: DOMRect, to: DOMRect) {
    if (!to.width) return undefined;
    const edges = { left: from.left - to.left, right: from.right - to.right };
    const draw = () =>
      gsap.set(el, {
        x: edges.left,
        scaleX: (to.width + edges.right - edges.left) / to.width,
      });
    const rightward = to.left > from.left;
    gsap.set(el, { transformOrigin: "0 50%" });
    draw();
    return gsap
      .timeline({
        onUpdate: draw,
        onComplete: () => gsap.set(el, { clearProps: "transform" }),
      })
      .to(
        edges,
        { [rightward ? "right" : "left"]: 0, duration: 0.24, ease: "expo.out" },
        0,
      )
      .to(
        edges,
        { [rightward ? "left" : "right"]: 0, duration: 0.38, ease: "expo.out" },
        0,
      );
  }

  $effect(() => () => {
    inkTween?.kill();
    blockTween?.kill();
  });

  // No digit is drawn on the tab; Settings › keybinds lists these.
  $effect(() => {
    if (hotkeys !== "shift") return;
    const pick = onpick;
    return pushScope([
      ...items
        .slice(0, 9)
        .map((item, i) => ({ key: subnavKey(i), run: () => pick(item.key) })),
      ...(vimState.enabled
        ? [
            { key: "shift+h", run: () => step(-1) },
            { key: "shift+l", run: () => step(1) },
          ]
        : []),
    ]);
  });
</script>

<nav
  class="tabs"
  class:shown={blockShown}
  style="--tab-anchor: {anchor}; --tab-on-anchor: {anchor}-on"
>
  {#each items as item}
    {@const on = item.key === active}
    {@const icon = labels === "text" ? undefined : item.icon}
    {@const Mark = labels === "text" ? undefined : item.mark}
    {@const bare = labels === "icons" && (icon !== undefined || !!Mark)}
    <button
      class="tab"
      class:on
      class:hover-host={item.key === hoverKey}
      aria-current={on ? "page" : undefined}
      aria-label={bare ? item.label : undefined}
      use:tip={bare ? item.label : undefined}
      onpointerenter={() => point(item.key, "pointer")}
      onpointerleave={() => unpoint("pointer")}
      onfocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) point(item.key, "focus");
      }}
      onblur={() => unpoint("focus")}
      onclick={(e) => {
        onpick(item.key);
        // After a pointer click the button keeps focus without :focus-visible,
        // and a later keypress would upgrade it to a focus ring. A keyboard
        // click (detail 0) keeps its ring.
        if (e.detail !== 0) e.currentTarget.blur();
      }}
      use:jellyPress
    >
      <span class="lbl"
        ><span class="br" aria-hidden="true">[</span>{#if Mark}<span class="ico"
            ><Mark size="1em" /></span
          >{:else if icon}<span class="ico"
            ><Icon name={icon} weight={7} /></span
          >{/if}{#if !bare}<span class="txt">{item.label}</span>{/if}<span
          class="br"
          aria-hidden="true">]</span
        ></span
      >
    </button>
  {/each}

  <span class="rule" aria-hidden="true"></span>
  <span class="block" aria-hidden="true" bind:this={blockEl}></span>
  <span class="ink" aria-hidden="true" bind:this={inkEl}></span>
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    /* The space between tabs is each tab's padding, so the pointer never leaves
       a tab while moving along the bar and the indicator stays expanded. */
    gap: 0;
    min-width: 0;
    /* Lets the indicator sit at z-index -1: behind the labels, in front of the
       surface under the bar. */
    isolation: isolate;
    /* A bar is pressed, not read: a drag across it must not select labels. */
    user-select: none;
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

  /* Laid out always and toggled by visibility, so a tab has the same width
     active or not. */
  .br {
    visibility: hidden;
  }
  .tab.on .br {
    visibility: visible;
  }

  /* Inline on the label's line, not a flex row: the label's box stays the line
     box, so the indicator anchored to it and the bar's height are the same in
     all three label modes. */
  .ico {
    display: inline-block;
    vertical-align: middle;
  }
  .ico + .txt {
    margin-left: 0.4em;
  }

  .rule {
    flex: 1;
    min-width: 1ch;
    height: 0;
    align-self: center;
    border-top: var(--panel-line);
    margin: 0 var(--pad-2);
  }

  /* The anchor is the label, not the button: the button includes the padding
     between tabs. No `position: relative` on .tabs or .tab, so the indicator's
     containing block is the surface the bar sits on. */
  .tab.hover-host .lbl {
    anchor-name: var(--tab-anchor);
  }
  .tab.on .lbl {
    anchor-name: var(--tab-on-anchor);
  }
  .tab.on.hover-host .lbl {
    anchor-name: var(--tab-anchor), var(--tab-on-anchor);
  }

  .tabs:not(:has(.tab.on)) .ink {
    opacity: 0;
  }

  @supports (anchor-name: --a) {
    /* Sized by the anchor and moved by `glide`, like the ink below: a
       transition on the insets would fight the tween. It fades where it stands. */
    .block {
      position: absolute;
      position-anchor: var(--tab-anchor);
      z-index: -1;
      pointer-events: none;
      left: calc(anchor(left) - var(--pad-2));
      right: calc(anchor(right) - var(--pad-2));
      top: calc(anchor(top) - var(--pad-1));
      bottom: calc(anchor(bottom) - var(--pad-1));
      background: var(--accent-dim);
      border-radius: var(--radius-control);
      opacity: 0;
      transition: opacity 280ms ease-out;
    }
    .tabs.shown .block {
      opacity: 1;
      transition-duration: 200ms;
    }

    .ink {
      position: absolute;
      position-anchor: var(--tab-on-anchor);
      z-index: -1;
      pointer-events: none;
      left: anchor(left);
      right: anchor(right);
      top: calc(anchor(bottom) + var(--pad-1));
      bottom: calc(anchor(bottom) - var(--pad-1) - var(--panel-line-w));
      background: var(--accent-fill);
      transition: opacity 200ms ease;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .block,
    .ink {
      transition: none;
    }
  }
</style>
