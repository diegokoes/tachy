<script lang="ts">
  let {
    value,
    unit,
    tone = "accent",
    size = "fig",
  }: {
    value: number;
    /** Printed small after the figure — "of 12", "chunks". */
    unit?: string;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    /** "fig" is the number a card leads with; "sm" rides inside a dial. */
    size?: "fig" | "sm";
  } = $props();
</script>

<span class="figure {tone} {size}">
  <span class="n">{value.toLocaleString()}</span>
  {#if unit}<span class="unit">{unit}</span>{/if}
</span>

<style>
  .figure {
    display: flex;
    align-items: baseline;
    gap: var(--pad-2);
    min-width: 0;
  }
  .n {
    font-family: var(--font-mono);
    /* tabular only where digits stack in a column; a lead figure gets the
       proportional widths so a 1 does not sit in a 0's cell. */
    line-height: 1.1;
  }
  .fig .n {
    font-size: var(--fs-fig);
  }
  .sm .n {
    font-size: var(--fs-lg);
  }

  .accent .n {
    color: var(--text);
  }
  .ok .n {
    color: var(--ok);
  }
  .warn .n {
    color: var(--warn);
  }
  .danger .n {
    color: var(--danger);
  }
  .muted .n {
    color: var(--muted);
  }

  .unit {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .sm .unit {
    display: none;
  }
</style>
