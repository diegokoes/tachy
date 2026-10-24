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
  <span class="add">
    {#key value.length}
      <Select
        value=""
        options={left}
        searchable
        creatable={free}
        placeholder={error ? "could not read the list" : "add"}
        aria-label={`add to ${label}`}
        onchange={(v) => add(String(v ?? ""))}
      />
    {/key}
  </span>
  {#if error}<span class="error">{error}</span>{/if}
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
  .add {
    display: flex;
    width: var(--control-w);
    max-width: 100%;
  }
  .add > :global(*) {
    flex: 1;
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-sm);
  }
</style>
