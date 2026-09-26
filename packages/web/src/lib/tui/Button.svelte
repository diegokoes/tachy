<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";

  let {
    variant = "default",
    tone,
    size = "md",
    square = false,
    icon,
    iconSize = "1.05em",
    morph = false,
    glyph,
    busy = false,
    disabled = false,
    full = false,
    title,
    type = "button",
    form,
    onclick,
    children,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
  }: {
    variant?: "default" | "primary" | "ghost" | "danger" | "ok";
    /** Semantic action color, independent of the button's chrome. */
    tone?: "danger" | "ok" | "info" | "accent" | "warn";
    size?: "sm" | "md";
    /** Fixed square button, for glyph/icon-only actions. */
    square?: boolean;
    /** Inline SVG icon; takes precedence over `glyph`. */
    icon?: IconName;
    iconSize?: string;
    /** Tween the icon into its next shape instead of swapping it. */
    morph?: boolean;
    glyph?: string;
    busy?: boolean;
    disabled?: boolean;
    full?: boolean;
    title?: string;
    type?: "button" | "submit";
    /** Submits a form this button is not nested in — the carved action row. */
    form?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
    "aria-label"?: string;
    "aria-pressed"?: boolean;
  } = $props();
</script>

<button
  class="btn {variant} {size}{tone ? ` tone-${tone}` : ''}"
  class:square
  class:full
  {type}
  {form}
  {title}
  aria-label={ariaLabel}
  aria-pressed={ariaPressed}
  aria-busy={busy || undefined}
  disabled={disabled || busy}
  {onclick}
>
  {#if busy}
    <span class="g" aria-hidden="true">…</span>
  {:else if icon}
    <Icon name={icon} size={iconSize} weight={7} {morph} />
  {:else if glyph}
    <span class="g" aria-hidden="true">{glyph}</span>
  {/if}
  {#if children}<span class="l"
      ><span class="t">{@render children()}</span><span
        class="t held"
        aria-hidden="true">{@render children()}</span
      ></span
    >{/if}
</button>

<style>
  /* --btn-edge is the border's colour, named so hover can thicken the edge in
     the same colour without knowing which variant drew it. */
  .btn {
    --btn-edge: var(--border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--btn-edge);
    border-radius: var(--radius-control);
    padding: var(--pad-2) var(--pad-4);
    transition:
      font-weight 0.12s ease,
      box-shadow 0.12s ease;
  }

  .btn.sm {
    font-size: var(--fs-sm);
    padding: var(--pad-1) var(--pad-3);
  }

  .btn.full {
    width: 100%;
  }

  .btn.square {
    width: var(--row-h);
    height: var(--row-h);
    padding: 0;
    flex: none;
  }
  .btn.square .g {
    font-size: var(--fs-md);
    line-height: 1;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.primary {
    --btn-edge: var(--accent);
    color: var(--accent);
    background: var(--accent-dim);
  }

  .btn.ghost {
    --btn-edge: transparent;
    color: var(--muted);
  }

  .btn.danger {
    --btn-edge: var(--danger);
    color: var(--danger);
  }

  .btn.ok {
    --btn-edge: var(--ok);
    color: var(--ok);
  }

  /* Tone colours the glyph and label; the border stays the variant's. */
  .btn.tone-danger { color: var(--danger); }
  .btn.tone-ok { color: var(--ok); }
  .btn.tone-info { color: var(--info); }
  .btn.tone-accent { color: var(--accent); }
  .btn.tone-warn { color: var(--warn); }

  /* Icon buttons have no chrome — no border, no fill, in any state. */
  .btn.square {
    --btn-edge: transparent;
    background: transparent;
  }

  /* Hover changes weight, never colour: the label goes bold and the edge
     thickens in the colour it already had. The edge is an inset shadow
     rather than a wider border so the button's box does not move. */
  .btn:hover:not(:disabled) {
    font-weight: var(--btn-hover-weight);
    box-shadow: inset 0 0 0 var(--btn-hover-edge) var(--btn-edge);
  }

  /* After hover, so a focused button under the pointer still shows it. */
  .btn:focus-visible:not(:disabled) {
    outline: none;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .btn.square:focus-visible:not(:disabled) {
    border-color: transparent;
    box-shadow: none;
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  .btn :global(svg) {
    transition: stroke-width 0.12s ease;
  }
  .btn:hover:not(:disabled) :global(svg) {
    stroke-width: var(--sw-hover, 9);
  }

  @media (prefers-reduced-motion: reduce) {
    .btn,
    .btn :global(svg) {
      transition: none;
    }
  }

  .g {
    flex: none;
    line-height: 1;
  }

  /* The label is laid out twice in one cell: once to read, and once at the
     hover weight, hidden, so the button is already as wide as its bold self
     and going bold never nudges its neighbours. */
  .l {
    display: grid;
    min-width: 0;
  }
  .t {
    grid-area: 1 / 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }
  .held {
    font-weight: var(--btn-hover-weight);
    visibility: hidden;
  }
</style>
