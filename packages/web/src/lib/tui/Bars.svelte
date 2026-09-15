<script lang="ts">
  export type Bar = {
    key: string;
    label: string;
    value: number;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
  };

  let {
    rows,
    max,
    unit,
  }: {
    rows: Bar[];
    /** Shared scale. Defaults to the largest row, so the top bar is always full. */
    max?: number;
    unit?: string;
  } = $props();

  const top = $derived(max ?? Math.max(1, ...rows.map((r) => r.value)));
</script>

<!-- One colour for every row. A ramp by size would spend the only free channel
     restating the length, which the bar already says. -->
<div class="bars">
  {#each rows as r (r.key)}
    <div class="row {r.tone ?? 'accent'}">
      <span class="lbl" title={r.label}>{r.label}</span>
      <span class="track">
        <span class="fill" style="width: {(r.value / top) * 100}%"></span>
      </span>
      <span class="n">{r.value.toLocaleString()}{unit ? ` ${unit}` : ""}</span>
    </div>
  {/each}
</div>

<style>
  .bars {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 8rem) 1fr auto;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
  }
  .lbl {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 0.5rem;
    min-width: 0;
    border-radius: 1px;
    background: color-mix(in srgb, var(--muted) 26%, transparent);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 1px;
    background: var(--tone-color);
  }
  .n {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .accent {
    --tone-color: var(--accent);
  }
  .ok {
    --tone-color: var(--ok);
  }
  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
  .muted {
    --tone-color: var(--muted);
  }
</style>
