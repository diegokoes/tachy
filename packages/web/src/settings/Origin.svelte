<script lang="ts">
  import { tip } from "../tui";
  import type { Origin } from "./prefs.svelte";

  let { of }: { of: Origin | null } = $props();
</script>

{#if of}
  <span class="origin" class:mine={of.mine} use:tip={of.tip}>{of.label}</span>
{/if}

<style>
  .origin {
    padding: 1px var(--pad-1);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
    cursor: help;
  }
  .origin.mine {
    border-style: solid;
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--accent);
  }
</style>
