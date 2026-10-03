<script lang="ts">
  import { fmtDate, fmtDateTime, utcTip } from "../dates.svelte";
  import { tip } from "./tip.svelte";

  /** A stored moment in the reader's format; the tip names the full time and its zone. */
  let { at, date = false }: { at: string | null | undefined; date?: boolean } =
    $props();
</script>

{#if at}<time datetime={at} use:tip={utcTip(at)}
    >{date ? fmtDate(at) : fmtDateTime(at)}</time
  >{:else if !date}-{/if}
