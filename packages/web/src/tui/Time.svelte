<script lang="ts">
  import { fmtDate, fmtDateTime } from "../dates.svelte";

  /** A stored moment in the reader's format. */
  let { at, date = false }: { at: string | null | undefined; date?: boolean } =
    $props();
</script>

{#if at}<time datetime={at}>{date ? fmtDate(at) : fmtDateTime(at)}</time
  >{:else if !date}-{/if}
