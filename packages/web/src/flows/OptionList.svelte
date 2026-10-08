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
    onchange: (value: string[]) => void;
  } = $props();

  let options = $state<FlowOption[]>([]);
  let error = $state<string | null>(null);
  let typed = $state("");
  const id = `optlist-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    const want = JSON.stringify([source, deps]);
    error = null;
    fetchOptions(source, deps)
      .then((loaded) => {
        if (want === JSON.stringify([source, deps])) options = loaded;
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label;
  const left = $derived(options.filter((o) => !value.includes(o.value)));

  function add(raw: string) {
    const added = raw.trim();
    if (added && !value.includes(added)) onchange([...value, added]);
  }
  function commit() {
    add(typed);
    typed = "";
  }
</script>

<div class="list">
  {#if value.length}
    <span class="chips">
      {#each value as picked (picked)}
        <Chip onremove={() => onchange(value.filter((x) => x !== picked))}
          >{labelOf(picked) ?? picked}</Chip
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
      {#each left as option (option.value)}<option value={option.value}
          >{option.label}</option
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
