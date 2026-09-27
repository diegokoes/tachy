<script lang="ts">
  import { Dial } from "../tui";

  type Tone = "accent" | "ok" | "warn" | "danger" | "muted";

  export type DialItem = {
    key: string;
    label: string;
    /** 0–1. */
    value: number;
    tone: Tone;
    /** Paints the unlit part too, for a split where neither side is missing. */
    rest?: Tone | "info";
    /** Inside the ring, usually the percentage. */
    center: string;
    /** Under the name, usually "12/15". */
    sub?: string;
    /** What the ring measures, in full, on hover. */
    title?: string;
    onclick?: () => void;
  };

  let { items }: { items: DialItem[] } = $props();

  /* The ring takes whichever runs out first — the tile's height less the two
     lines under it, or its share of the width — and never more than 6.5rem. */
  const size = $derived(
    `min(6.5rem, calc(100cqh - 2.9rem), calc(100cqw / ${Math.max(1, items.length)} - 1.25rem))`,
  );
</script>

{#snippet one(d: DialItem)}
  <Dial value={d.value} tone={d.tone} rest={d.rest} label={d.title ?? d.label} {size}>
    <span class="core">{d.center}</span>
  </Dial>
  <span class="name">{d.label}</span>
  {#if d.sub}<span class="sub">{d.sub}</span>{/if}
{/snippet}

<div class="dials">
  {#each items as d (d.key)}
    {#if d.onclick}
      <button class="one go" title={d.title} onclick={d.onclick}>{@render one(d)}</button>
    {:else}
      <div class="one" title={d.title}>{@render one(d)}</div>
    {/if}
  {/each}
</div>

<style>
  .dials {
    display: flex;
    align-items: center;
    justify-content: space-around;
    gap: var(--pad-2);
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .one {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: center;
  }
  .go {
    cursor: pointer;
  }
  .go:hover,
  .go:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }
  .core {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .name {
    margin-top: var(--pad-1);
    max-width: 100%;
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
