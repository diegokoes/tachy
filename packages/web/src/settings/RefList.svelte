<script lang="ts">
  import Chord from "./Chord.svelte";

  let {
    rows,
    off = false,
  }: { rows: { keys: string[]; what: string }[]; off?: boolean } = $props();
</script>

<ul class:off>
  {#each rows as row}
    <li>
      <span class="what">{row.what}</span>
      <span class="leader" aria-hidden="true"></span>
      <span class="keys">
        {#each row.keys as chord, i}
          {#if i}<span class="or">/</span>{/if}<Chord {chord} />
        {/each}
      </span>
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ul.off {
    opacity: 0.5;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-height: var(--row-h);
    padding: var(--pad-1) 0;
  }
  .what {
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .leader {
    flex: 1;
    min-width: var(--pad-4);
    border-bottom: 1px dotted var(--border);
  }
  .keys {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--pad-1);
  }
  .or {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
