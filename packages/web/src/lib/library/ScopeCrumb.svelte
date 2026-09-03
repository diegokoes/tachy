<script lang="ts">
  import { G } from "../tui";

  /**
   * `product_area` is written at save time by getComponentPath and already
   * carries the whole chain, product name first — "FTRACE / Label Printer /
   * Firmware". Components nest arbitrarily deep, so this renders whatever
   * depth the entry actually has rather than a fixed product+component pair.
   */
  let { area }: { area?: string | null } = $props();

  const parts = $derived(
    (area ?? "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean),
  );
</script>

{#if parts.length}
  <nav class="crumb" aria-label="scope">
    {#each parts as part, i}
      {#if i > 0}<span class="sep" aria-hidden="true">{G.right}</span>{/if}
      <span class:leaf={i === parts.length - 1}>{part}</span>
    {/each}
  </nav>
{/if}

<style>
  /* Its own vertical rhythm, because it renders nothing at all when an entry
     has no scope — a wrapper padding an empty box was the alternative. */
  .crumb {
    display: flex;
    margin: var(--pad-2) 0;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pad-1);
    min-width: 0;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    /* Muted throughout so it never competes with the title it sits above. */
    color: color-mix(in srgb, var(--muted) 75%, transparent);
  }
  .sep {
    opacity: 0.7;
  }
  .leaf {
    color: var(--muted);
  }
</style>
