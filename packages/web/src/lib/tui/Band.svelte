<script lang="ts">
  export type Segment = {
    key: string;
    label: string;
    n: number;
    tone: "accent" | "ok" | "warn" | "danger" | "muted" | "info";
  };

  let {
    segments,
    total,
    caption,
    label,
  }: {
    /**
     * Mutually exclusive parts of one population — that is what makes the
     * widths a whole rather than several unrelated ratios.
     */
    segments: Segment[];
    total: number;
    caption?: string;
    label: string;
  } = $props();

  const shown = $derived(segments.filter((s) => s.n > 0));
</script>

<div class="wrap">
  <div class="band" role="img" aria-label="{label}: {caption ?? ''}">
    {#each shown as s (s.key)}
      <span
        class="seg {s.tone}"
        style="--w: {(s.n / total) * 100}%"
        title="{s.n} {s.label}"
      ></span>
    {/each}
  </div>
  <div class="legend">
    {#each shown as s (s.key)}
      <span class="key {s.tone}">{s.n.toLocaleString()} {s.label}</span>
    {/each}
  </div>
  {#if caption}<span class="caption">{caption}</span>{/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }

  /* The 2px gap is the separator. A stroke around each segment would add ink
     that is not data, and neighbouring tones read as distinct because of the
     ground showing through. */
  .band {
    display: flex;
    gap: 2px;
    height: 0.5rem;
    border-radius: 1px;
    overflow: hidden;
  }
  .seg {
    width: var(--w);
    min-width: 2px;
    background: var(--tone-color);
    border-radius: 1px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .key::before {
    content: "";
    display: inline-block;
    width: 0.42em;
    height: 0.85em;
    margin-right: var(--pad-1);
    vertical-align: middle;
    border-radius: 1px;
    background: var(--tone-color);
  }

  .caption {
    font-size: var(--fs-xs);
    color: var(--muted);
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
  .info {
    --tone-color: var(--info);
  }
</style>
