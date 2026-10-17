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
    extra = [],
    label,
    placeholder,
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
    /** Choices offered ahead of the source's own. */
    extra?: FlowOption[];
    label: string;
    placeholder?: string;
    onchange: (value: string) => void;
  } = $props();

  let options = $state<FlowOption[]>([]);
  let error = $state<string | null>(null);
  const missing = $derived(needs.filter((n) => !deps[n]));

  $effect(() => {
    const want = JSON.stringify([source, deps]);
    if (missing.length) {
      options = [];
      return;
    }
    error = null;
    fetchOptions(source, deps)
      .then((loaded) => {
        if (want === JSON.stringify([source, deps])) options = loaded;
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });

  const all = $derived([...extra, ...options]);
  const shown = $derived(
    value && !all.some((o) => o.value === value)
      ? [{ value, label: value }, ...all]
      : all,
  );
  const prompt = $derived.by(() => {
    if (missing.length) return `pick ${missing.join(", ")} first`;
    if (error) return "could not read the list";
    return placeholder;
  });
</script>

<Select
  {value}
  options={free ? all : shown}
  searchable
  creatable={free}
  disabled={missing.length > 0}
  placeholder={prompt}
  aria-label={label}
  onchange={(v) => onchange(String(v ?? ""))}
/>
