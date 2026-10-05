<script lang="ts">
  import Chord from "./Chord.svelte";

  let {
    rows,
    off = false,
  }: { rows: { keys: string[]; what: string }[]; off?: boolean } = $props();
</script>

<ul class:off>
  {#each rows as r}
    <li>
      <span class="what">{r.what}</span>
      <span class="leader" aria-hidden="true"></span>
      <span class="keys">
        {#each r.keys as k, i}
          {#if i}<span class="or">/</span>{/if}<Chord chord={k} />
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
