<script lang="ts">
  import { CaretInput, Chip, NoMatch } from "../tui";
  import type { FacetCount } from "./filters";

  let {
    value = "",
    options = [],
    onchange,
  }: {
    /** Comma-joined, so it stores and travels as one query param. */
    value: string;
    options: FacetCount[];
    onchange: (v: string) => void;
  } = $props();

  const picked = $derived(value ? value.split(",").filter(Boolean) : []);

  let query = $state("");
  let focused = $state(false);
  let root = $state<HTMLElement>();

  /** Only tags that are still addable, and still have rows behind them. */
  const matches = $derived(
    options
      .filter(
        (o) =>
          !picked.includes(o.value) &&
          o.value.toLowerCase().includes(query.trim().toLowerCase()),
      )
      .slice(0, 12),
  );

  const typed = $derived(query.trim() !== "");
  const open = $derived(focused && (matches.length > 0 || typed));

  function add(tag: string) {
    if (picked.includes(tag)) return;
    onchange([...picked, tag].join(","));
    query = "";
  }

  function remove(tag: string) {
    onchange(picked.filter((t) => t !== tag).join(","));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && matches.length) {
      e.preventDefault();
      add(matches[0].value);
    } else if (e.key === "Backspace" && !query && picked.length) {
      remove(picked[picked.length - 1]);
    } else if (e.key === "Escape") {
      focused = false;
    }
  }
</script>

<svelte:window
  onmousedown={(e) => {
    if (root && !root.contains(e.target as Node)) focused = false;
  }}
/>

<div class="tags" class:active={picked.length > 0} bind:this={root}>
  <div class="row">
    {#each picked as tag (tag)}
      <Chip tone="accent" onremove={() => remove(tag)}>{tag}</Chip>
    {/each}
    <CaretInput
      bind:value={query}
      title="Filter by tag, right click to remove"
      aria-label="filter by tag"
      onfocus={() => (focused = true)}
      onkeydown={onKey}
    />
  </div>

  {#if open}
    <ul class="suggest">
      {#each matches as m (m.value)}
        <li>
          <button type="button" onclick={() => add(m.value)}>
            <span class="t">{m.value}</span>
            <span class="n">{m.count}</span>
          </button>
        </li>
      {:else}
        <li>
          {#key query}
            <NoMatch onclear={() => (query = "")} />
          {/key}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .tags {
    position: relative;
    min-width: 12rem;
    max-width: 22rem;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--pad-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--panel);
    padding: var(--pad-2) var(--pad-3);
  }
  .tags.active .row {
    border-color: var(--accent);
  }

  .suggest {
    position: absolute;
    z-index: var(--z-dropdown);
    top: calc(100% + var(--pad-1));
    left: 0;
    right: 0;
    max-height: 14rem;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--accent);
    border-radius: var(--radius-control);
    background: var(--panel-solid);
  }
  .suggest button {
    display: flex;
    width: 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gap);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text);
    background: none;
    border: none;
    border-radius: 0;
    padding: var(--pad-1) var(--pad-3);
    cursor: pointer;
    text-align: left;
  }
  .suggest button:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .suggest button:hover .n {
    color: var(--bg);
  }
  .n {
    flex: none;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
</style>
