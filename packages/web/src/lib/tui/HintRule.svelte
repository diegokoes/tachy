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
  kbd {
    font: inherit;
    color: var(--accent);
  }
</style>
