<script lang="ts">
  
  let { label, items }: { label: string; items: string[] | null | undefined } = $props();
</script>

{#if items && items.length}
  <div class="facet">
    <span class="label">{label}</span>
    <span class="chips">
      {#each items as it}<span class="chip">{it}</span>{/each}
    </span>
  </div>
{/if}

<style>
  .facet {
    display: flex;
    gap: 0.5rem;
    margin: 0.35rem 0;
    align-items: baseline;
  }
  .label {
    color: var(--muted);
    font-size: 0.8rem;
    min-width: 5.5rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip {
    background: var(--accent-dim);
    color: var(--text);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.78rem;
  }
</style>
