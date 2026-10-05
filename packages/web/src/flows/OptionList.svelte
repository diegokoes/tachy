<script lang="ts">
  import type { FlowOption } from "@tachy/contract";
  import { Chip, Select } from "../tui";
  import { fetchOptions } from "./options.svelte";

  let {
    source,
    deps = {},
    value,
    free = false,
    label,
    onchange,
  }: {
    /** The option source key, as a param's `x-options` names it. */
    source: string;
    deps?: Record<string, string>;
    value: string[];
    /** Anything typed is fine too; the list only suggests. */
    free?: boolean;
    label: string;
    onchange: (v: string[]) => void;
  } = $props();

  let options = $state<FlowOption[]>([]);
  let error = $state<string | null>(null);
  let typed = $state("");
  const id = `optlist-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    const want = JSON.stringify([source, deps]);
    error = null;
    fetchOptions(source, deps)
      .then((o) => {
        if (want === JSON.stringify([source, deps])) options = o;
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label;
  const left = $derived(options.filter((o) => !value.includes(o.value)));

  function add(v: string) {
    const x = v.trim();
    if (x && !value.includes(x)) onchange([...value, x]);
  }
  function commit() {
    add(typed);
    typed = "";
  }
</script>

<div class="list">
  {#if value.length}
    <span class="chips">
      {#each value as v (v)}
        <Chip onremove={() => onchange(value.filter((x) => x !== v))}
          >{labelOf(v) ?? v}</Chip
        >
      {/each}
    </span>
  {/if}
  {#if free}
    <input
      list={id}
      bind:value={typed}
      aria-label={`Add to ${label}`}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      onchange={commit}
    />
    <datalist {id}>
      {#each left as o (o.value)}<option value={o.value}>{o.label}</option
        >{/each}
    </datalist>
  {:else}
    <Select
      value=""
      options={left}
      searchable
      placeholder={error ? "could not read the list" : undefined}
      aria-label={`Add to ${label}`}
      onchange={(v) => add(String(v ?? ""))}
    />
  {/if}
</div>

<style>
  .list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  input {
    width: 100%;
  }
</style>
