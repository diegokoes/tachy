<script lang="ts">
  let {
    value,
    width = 10,
    tone = "accent",
    label,
  }: {
    value: number;
    width?: number;
    tone?: "accent" | "ok" | "warn" | "danger" | "muted";
    label?: string;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));

  const bar = $derived.by(() => {
    const exact = pct * width;
    const full = Math.floor(exact);
    const rest = exact - full;
    const partial = rest > 0.66 ? "▓" : rest > 0.33 ? "▒" : rest > 0 ? "░" : "";
    const lit = "█".repeat(full) + partial;
    return { lit, dim: "░".repeat(Math.max(0, width - lit.length)) };
  });
</script>

<span
  class="meter {tone}"
  role="meter"
  aria-valuenow={Math.round(pct * 100)}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-label={label}
>
  <span class="lit">{bar.lit}</span><span class="dim">{bar.dim}</span>
</span>

<style>
  .meter {
    display: inline-block;
    /* RAMP mixes · with the block glyphs, and a proportional face has · but
       not █░▒▓ — the bar would be drawn half from the UI font and half from
       whatever fallback supplies the blocks, and stop lining up. */
    font-family: var(--font-mono);
    letter-spacing: -0.04em;
    line-height: 1;
    white-space: pre;
    user-select: none;
  }
  .dim {
    color: color-mix(in srgb, var(--muted) 55%, transparent);
  }
  .accent .lit,
  .meter.accent .lit {
    color: var(--accent);
  }
  .meter.ok .lit {
    color: var(--ok);
  }
  .meter.warn .lit {
    color: var(--warn);
  }
  .meter.danger .lit {
    color: var(--danger);
  }
  .meter.muted .lit {
    color: var(--muted);
  }
</style>
