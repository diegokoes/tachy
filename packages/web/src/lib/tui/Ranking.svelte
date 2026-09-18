<script lang="ts">
  export type Ranked = {
    key: string;
    label: string;
    /** Already formatted — the caller knows whether it is tokens or dollars. */
    value: string;
    /** A second, quieter fact about the same row. */
    note?: string;
    tone?: "warn" | "danger";
  };

  let { rows, empty = "nothing yet" }: { rows: Ranked[]; empty?: string } =
    $props();
</script>

{#if rows.length}
  <ol class="ranking">
    {#each rows as r (r.key)}
      <li class={r.tone}>
        <span class="lbl" title={r.label}>{r.label}</span>
        {#if r.note}<span class="note">{r.note}</span>{/if}
        <span class="val">{r.value}</span>
      </li>
    {/each}
  </ol>
{:else}
  <span class="empty">{empty}</span>
{/if}

<style>
  .ranking {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    width: 100%;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--pad-2);
  }
  .lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    color: var(--tone-color, var(--muted));
    white-space: nowrap;
  }
  /* Tabular here, unlike a lead figure: these stack in a column and are read
     against each other. */
  .val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    text-align: right;
  }
  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
  .empty {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
