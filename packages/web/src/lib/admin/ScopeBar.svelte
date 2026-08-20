<script lang="ts">
  import Select from "../AsciiSelect.svelte";
  import type { Opt } from "../tui";

  let {
    label,
    value = $bindable(),
    options,
  }: {
    label: string;
    value: string;
    options: Opt[];
  } = $props();
</script>

<!-- Deliberately not a Field: this picks which records the table below shows,
     it does not edit anything. Records are edited in their own dialog. -->
<div class="scope">
  <span class="k">showing</span>
  <span class="l">{label}</span>
  <Select bind:value {options} aria-label={label} active />
</div>

<style>
  .scope {
    display: flex;
    align-items: center;
    gap: var(--gap);
    flex-wrap: wrap;
    margin-bottom: var(--pad-3);
    padding-bottom: var(--pad-2);
    border-bottom: 1px dashed var(--border);
  }
  .k,
  .l {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .l {
    color: var(--text);
  }
</style>
