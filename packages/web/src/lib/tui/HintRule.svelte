<script lang="ts">
  let { hints }: { hints: { key: string; label: string }[] } = $props();
</script>

{#if hints.length}
  <div class="hints">
    {#each hints as h}
      <span class="h"><kbd>{h.key}</kbd>{h.label}</span>
    {/each}
  </div>
{/if}

<style>
  .hints {
    display: flex;
    align-items: baseline;
    gap: var(--pad-3);
    flex-wrap: wrap;
    font-size: var(--fs-xs);
    color: var(--muted);
    user-select: none;
  }
  .h {
    display: inline-flex;
    gap: 0.35em;
    white-space: nowrap;
  }
  /* Key names are keycaps, not words — mono, but at the row's own size rather
     than the browser's default kbd styling. */
  kbd {
    font-family: var(--font-mono);
    font-size: inherit;
    color: var(--accent);
  }
</style>
