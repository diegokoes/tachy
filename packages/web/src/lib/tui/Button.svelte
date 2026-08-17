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
    glyph,
    busy = false,
    disabled = false,
    full = false,
    title,
    type = "button",
    onclick,
    children,
    "aria-label": ariaLabel,
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
    glyph?: string;
    busy?: boolean;
    disabled?: boolean;
    full?: boolean;
    title?: string;
    type?: "button" | "submit";
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
    "aria-label"?: string;
  } = $props();
</script>

<button
  class="btn {variant} {size}{tone ? ` tone-${tone}` : ''}"
  class:square
  class:full
  {type}
  {title}
  aria-label={ariaLabel}
  aria-busy={busy || undefined}
  disabled={disabled || busy}
  {onclick}
>
  {#if busy}
    <span class="g" aria-hidden="true">…</span>
  {:else if icon}
    <Icon name={icon} size={iconSize} weight={7} />
  {:else if glyph}
    <span class="g" aria-hidden="true">{glyph}</span>
  {/if}
  {#if children}<span class="l">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--pad-2) var(--pad-4);
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

  .btn:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .btn.default:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Primary inverts to a solid accent block on hover — text-mode selection. */
  .btn.primary {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-dim);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

  .btn.ghost {
    border-color: transparent;
    color: var(--muted);
  }
  .btn.ghost:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent-dim);
  }

  .btn.danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
  }

  .btn.ok {
    border-color: var(--ok);
    color: var(--ok);
  }
  .btn.ok:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }

  /* Tone colors the glyph/label and the hover affordance; border and
     background stay whatever the variant says. */
  .btn.tone-danger { color: var(--danger); }
  .btn.tone-ok { color: var(--ok); }
  .btn.tone-info { color: var(--info); }
  .btn.tone-accent { color: var(--accent); }
  .btn.tone-warn { color: var(--warn); }

  .btn.tone-danger:hover:not(:disabled) {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .btn.tone-ok:hover:not(:disabled) {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 15%, transparent);
  }
  .btn.tone-info:hover:not(:disabled) {
    border-color: var(--info);
    background: color-mix(in srgb, var(--info) 15%, transparent);
  }
  .btn.tone-accent:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .btn.tone-warn:hover:not(:disabled) {
    border-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 15%, transparent);
  }


  /* Icon buttons have no chrome — no border, no fill, in any state. The mark
     brightens and thickens instead, which is the only thing that moves. */
  .btn.square,
  .btn.square:hover:not(:disabled),
  .btn.square.default:hover:not(:disabled),
  .btn.square.ghost:hover:not(:disabled),
  .btn.square.tone-danger:hover:not(:disabled),
  .btn.square.tone-ok:hover:not(:disabled),
  .btn.square.tone-info:hover:not(:disabled),
  .btn.square.tone-accent:hover:not(:disabled),
  .btn.square.tone-warn:hover:not(:disabled) {
    background: transparent;
    border-color: transparent;
  }

  /* The filled variants invert their text against a solid fill on hover — with
     no fill to sit on, that paints the mark in the background color. Square
     buttons keep their own color and brighten instead. */
  .btn.square.primary:hover:not(:disabled) {
    color: var(--accent);
  }
  .btn.square.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .btn.square.ok:hover:not(:disabled) {
    color: var(--ok);
  }

  .btn :global(svg) {
    transition:
      stroke-width 0.12s ease,
      filter 0.12s ease;
  }
  .btn:hover:not(:disabled) :global(svg) {
    stroke-width: 9;
    filter: brightness(1.35);
  }
  /* Keyboard focus still needs to be visible — that is not a hover effect. */
  .btn.square:focus-visible {
    box-shadow: none;
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn :global(svg) {
      transition: none;
    }
  }

  .g {
    flex: none;
    line-height: 1;
  }
  .l {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
