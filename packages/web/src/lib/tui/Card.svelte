<script lang="ts">
  import type { Snippet } from "svelte";
  import { RAMP } from "./glyphs";

  let {
    label,
    span = 1,
    lines = 3,
    loading = false,
    children,
  }: {
    label?: string;
    /**
     * Columns to occupy in the Deck it sits in, or "full" for the whole row —
     * which is the only honest answer for a card that has to be as wide as the
     * deck, since how many columns that is depends on the window.
     * Collapses to one column when narrow.
     */
    span?: 1 | 2 | 3 | "full";
    /** Skeleton rows drawn while `loading`, sized to what the card will hold. */
    lines?: number;
    loading?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="card" class:full={span === "full"} style="--span: {span}">
  {#if label}<span class="label">{label}</span>{/if}
  {#if loading}
    <div class="skeleton" aria-label="loading">
      {#each { length: lines } as _, i}
        <span style="--w: {80 - i * 14}%">{RAMP[0].repeat(40)}</span>
      {/each}
    </div>
  {:else}
    {@render children()}
  {/if}
</div>

<style>
  .card {
    grid-column: span var(--span);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pad-2);
    min-width: 0;
    padding: var(--pad-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .card.full {
    grid-column: 1 / -1;
  }

  .label {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--border);
    letter-spacing: 0.35em;
    user-select: none;
  }
  .skeleton span {
    display: block;
    width: var(--w);
    overflow: hidden;
    white-space: nowrap;
  }

  /* The same breakpoint the admin rail collapses at: past it the content
     column is too narrow for a card to be worth two of anything. */
  @media (max-width: 52rem) {
    .card,
    .card.full {
      grid-column: auto;
    }
  }
</style>
