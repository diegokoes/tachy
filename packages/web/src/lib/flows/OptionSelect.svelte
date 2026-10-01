<script lang="ts">
  import type { FlowOption } from "@tachy/contract";
  import { Select } from "../tui";
  import { fetchOptions } from "./options.svelte";

  let {
    source,
    deps = {},
    needs = [],
    value,
    free = false,
    label,
    placeholder = "pick…",
    onchange,
  }: {
    /** The option source key, as a param's `x-options` names it. */
    source: string;
    deps?: Record<string, string>;
    /** Deps the list cannot be read without. */
    needs?: string[];
    value: string;
    /** Anything typed is fine too; the list only suggests. */
    free?: boolean;
    label: string;
    placeholder?: string;
    onchange: (v: string) => void;
  } = $props();

  let options = $state<FlowOption[]>([]);
  let error = $state<string | null>(null);
  const missing = $derived(needs.filter((n) => !deps[n]));
  const id = `opt-${Math.random().toString(36).slice(2, 9)}`;

  $effect(() => {
    const want = JSON.stringify([source, deps]);
    if (missing.length) {
      options = [];
      return;
    }
    error = null;
    fetchOptions(source, deps)
      .then((o) => {
        if (want === JSON.stringify([source, deps])) options = o;
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const shown = $derived(
    value && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options,
  );
</script>

{#if free}
  <input
    list={id}
    {value}
    aria-label={label}
    placeholder={missing.length
      ? `pick ${missing.join(", ")} first`
      : placeholder}
    title={error ?? undefined}
    oninput={(e) => onchange((e.target as HTMLInputElement).value)}
  />
  <datalist {id}>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option
      >{/each}
  </datalist>
{:else}
  <Select
    {value}
    options={shown}
    searchable
    disabled={missing.length > 0}
    placeholder={missing.length
      ? `pick ${missing.join(", ")} first`
      : error
        ? "could not read the list"
        : placeholder}
    title={error ?? undefined}
    aria-label={label}
    onchange={(v) => onchange(String(v ?? ""))}
  />
{/if}
