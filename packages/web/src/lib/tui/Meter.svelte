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

  const pct = $derived(
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)),
  );

  /* Cells are lit whole, then the one straddling the boundary carries the
     remainder as opacity — the fractional shading the ░▒▓ ramp used to do,
     without asking a font for three glyphs it may not have. */
  const cells = $derived.by(() => {
    const exact = pct * width;
    return Array.from({ length: width }, (_, i) =>
      Math.max(0, Math.min(1, exact - i)),
    );
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
  {#each cells as fill}
    <span class="cell" class:lit={fill > 0} style="--fill: {fill}"></span>
  {/each}
</span>

<style>
  /* Drawn, not typed. The bar used to be a string of █░▒▓ on --font-mono, and
     neither bundled face carries those glyphs — every cell came from whatever
     fallback the OS supplied, at whatever width it happened to be. */
  .meter {
    display: inline-flex;
    gap: 0.1em;
    align-items: center;
    vertical-align: middle;
    user-select: none;
  }
  .cell {
    width: 0.42em;
    height: 0.85em;
    border-radius: 1px;
    background: color-mix(in srgb, var(--muted) 30%, transparent);
  }
  .cell.lit {
    background: color-mix(
      in srgb,
      var(--tone-color) calc(var(--fill) * 100%),
      color-mix(in srgb, var(--muted) 30%, transparent)
    );
  }

  .meter.accent {
    --tone-color: var(--accent);
  }
  .meter.ok {
    --tone-color: var(--ok);
  }
  .meter.warn {
    --tone-color: var(--warn);
  }
  .meter.danger {
    --tone-color: var(--danger);
  }
  .meter.muted {
    --tone-color: var(--muted);
  }
</style>
