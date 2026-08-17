<script lang="ts">
  import { Chip } from "./tui";

  let {
    label,
    items,
  }: { label: string; items: string[] | null | undefined } = $props();
</script>

{#if items && items.length}
  <div class="facet">
    <span class="label">{label}</span>
    <span class="chips">
      {#each items as it}<Chip>{it}</Chip>{/each}
    </span>
  </div>
{/if}

<style>
  .facet {
    display: flex;
    gap: var(--gap);
    margin: var(--pad-1) 0;
    align-items: baseline;
  }
  .label {
    color: var(--muted);
    font-size: var(--fs-sm);
    min-width: 5.5rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
</style>
