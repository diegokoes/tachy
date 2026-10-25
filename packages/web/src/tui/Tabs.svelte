<script lang="ts">
  import { pushScope } from "../keys/keys.svelte";
  import { subnavKey } from "../keys/bindings.svelte";
  import { vimState } from "../keys/vim.svelte";
  import { gsap, reducedMotion } from "../motion/gsap";
  import { jellyPress } from "../motion/motion";
  import Icon from "./Icon.svelte";
  import type { Component } from "svelte";
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

  // `active` may name no item (settings is not a tab). The anchor then stays on
  // the last tab that was active, hidden by opacity, so the indicator's next
  // hover starts from a resolved position.
  let stickyKey = $state<string | null>(null);
  $effect(() => {
    if (activeMatches) stickyKey = active;
  });

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
    glideInk(inkEl, inkBefore, inkEl.getBoundingClientRect());
  });

  function glideInk(el: HTMLElement, from: DOMRect, to: DOMRect) {
    if (!to.width) return;
    const edges = { left: from.left - to.left, right: from.right - to.right };
    const draw = () =>
      gsap.set(el, {
        x: edges.left,
        scaleX: (to.width + edges.right - edges.left) / to.width,
      });
    const rightward = to.left > from.left;
    gsap.set(el, { transformOrigin: "0 50%" });
    draw();
    inkTween = gsap
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

  $effect(() => () => inkTween?.kill());

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

<nav class="tabs" style="--tab-anchor: {anchor}; --tab-on-anchor: {anchor}-on">
  {#each items as item}
    {@const on = item.key === active}
    {@const anchorHost =
      item.key === (activeMatches ? active : (stickyKey ?? items[0]?.key))}
    {@const icon = labels === "text" ? undefined : item.icon}
    {@const Mark = labels === "text" ? undefined : item.mark}
    {@const bare = labels === "icons" && (icon !== undefined || !!Mark)}
    <button
      class="tab"
      class:on
      class:anchor-host={anchorHost}
      aria-current={on ? "page" : undefined}
      aria-label={bare ? item.label : undefined}
      use:tip={bare ? item.label : undefined}
      onclick={(e) => {
        onpick(item.key);
        // After a pointer click the button keeps focus without :focus-visible,
        // and a later keypress upgrades it and moves the indicator off the
        // active tab. A keyboard click (detail 0) keeps its focus ring.
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

    /* A damped spring cut where it first crosses back through 1 and re-timed
       to end there: the tail past that point reads as a second bounce. */
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
  .tab:hover .lbl,
  .tab:focus-visible .lbl,
  .tab.anchor-host:not(.on) .lbl {
    anchor-name: var(--tab-anchor);
  }
  /* The active label also holds the ink's name, whatever the pointer does. */
  .tab.on .lbl {
    anchor-name: var(--tab-anchor), var(--tab-on-anchor);
  }

  /* One element holds the name at a time: duplicate anchor names resolve to
     the last in tree order, so a hovered tab before the active one would lose
     to it. The sticky fallback gives the name up the same way. */
  .tabs:has(.tab:is(:hover, :focus-visible))
    .tab.anchor-host:not(.on):not(:hover, :focus-visible)
    .lbl {
    anchor-name: none;
  }
  .tabs:has(.tab:is(:hover, :focus-visible))
    .tab.on:not(:hover, :focus-visible)
    .lbl {
    anchor-name: var(--tab-on-anchor);
  }

  /* At rest the hover block folds into the active tab's ink and fades, and
     with no tab on it keeps the sticky tab's position, so the next hover
     animates from a resolved place. */
  .tabs:not(:has(.tab:is(:hover, :focus-visible)))::before {
    opacity: 0;
  }
  .tabs:not(:has(.tab.on)) .ink {
    opacity: 0;
  }

  @supports (anchor-name: --a) {
    /* An inset from anchor() is measured from that inset's own edge, so the
       same sign moves top and bottom in opposite directions. */
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
      background: var(--accent-fill);
      border-radius: 0;
      /* Spring on the horizontal edges only: overshoot on top and bottom makes
         the underline-to-block growth wobble. */
      transition:
        left 320ms var(--tab-spring),
        right 320ms var(--tab-spring),
        top 180ms ease-out,
        bottom 180ms ease-out,
        background-color 200ms ease,
        border-radius 200ms ease,
        opacity 200ms ease;
    }

    /* Sized by the anchor, moved by `glideInk`: a transition on the insets
       would fight the tween. */
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

    /* The anchor name stays the same and only the edges read off it change,
       so the insets interpolate. */
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
    .tabs::before,
    .ink {
      transition: none;
    }
  }
</style>
