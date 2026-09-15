<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    value,
    segments = 28,
    tone = "accent",
    label,
    size = "5.5rem",
    children,
  }: {
    /** 0-1. */
    value: number;
    segments?: number;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    label: string;
    size?: string;
    /** The figure that sits in the middle. */
    children?: Snippet;
  } = $props();

  const pct = $derived(
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)),
  );

  /* Meter's algorithm in polar coordinates: whole ticks light, and the one
     straddling the boundary carries the remainder as a mix towards the track.
     Ticks are drawn rather than typed for the same reason Meter's cells are —
     neither bundled face carries a block glyph. */
  const lit = $derived.by(() => {
    const exact = pct * segments;
    return Array.from({ length: segments }, (_, i) =>
      Math.max(0, Math.min(1, exact - i)),
    );
  });

  const R_IN = 33;
  const R_OUT = 45;
  const ticks = $derived(
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      return {
        x1: 50 + cos * R_IN,
        y1: 50 + sin * R_IN,
        x2: 50 + cos * R_OUT,
        y2: 50 + sin * R_OUT,
      };
    }),
  );
</script>

<div
  class="dial {tone}"
  style="--size: {size}"
  role="meter"
  aria-valuenow={Math.round(pct * 100)}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-label={label}
>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    {#each ticks as t, i}
      <line
        x1={t.x1}
        y1={t.y1}
        x2={t.x2}
        y2={t.y2}
        class:on={lit[i] > 0}
        style="--fill: {lit[i]}"
      />
    {/each}
  </svg>
  {#if children}
    <div class="core">{@render children()}</div>
  {/if}
</div>

<style>
  /* The track is a lighter step of the fill's own colour, not neutral grey:
     a ring at zero has nothing lit, and a zero that means "none of these have
     a token" has to read differently from a zero that means "there are none". */
  .dial {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
    --track: color-mix(in srgb, var(--tone-color) 28%, transparent);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  line {
    stroke: var(--track);
    stroke-width: 4;
    stroke-linecap: butt;
  }
  line.on {
    stroke: color-mix(
      in srgb,
      var(--tone-color) calc(var(--fill) * 100%),
      var(--track)
    );
  }

  .core {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    text-align: center;
    line-height: 1.1;
  }

  .accent {
    --tone-color: var(--accent);
  }
  .ok {
    --tone-color: var(--ok);
  }
  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
  .muted {
    --tone-color: var(--muted);
    --track: color-mix(in srgb, var(--muted) 26%, transparent);
  }
</style>
