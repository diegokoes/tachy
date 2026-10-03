<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "./gsap";

  let { label = "loading" }: { label?: string } = $props();

  const W = 16;
  /** Cells behind the head, brightest first — the old ▓▒░ ramp as opacity. */
  const TAIL = [1, 0.62, 0.35, 0.16];

  let tick = $state(0);
  let visible = $state(false);
  let reduced = $state(false);

  const cells = $derived.by(() => {
    const p = tick % (W + 5);
    return Array.from({ length: W }, (_, i) => TAIL[p - i] ?? 0);
  });

  onMount(() => {
    reduced = reducedMotion();
    visible = true;
    const iv = reduced ? undefined : setInterval(() => tick++, 90);
    return () => {
      if (iv !== undefined) clearInterval(iv);
    };
  });
</script>

<div class="spinner" class:visible role="status" aria-label={label}>
  <div class="inner">
    {#if !reduced}
      <div class="frame" aria-hidden="true">
        {#each cells as heat}
          <span class="cell" class:lit={heat > 0} style="--heat: {heat}"></span>
        {/each}
      </div>
    {/if}
    <div class="label">{label}…</div>
  </div>
</div>

<style>
  .spinner {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .spinner.visible {
    opacity: 1;
  }

  .inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-3);
    padding: var(--pad-4);
    /* dim what's behind so the comet reads on any pattern */
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border-radius: var(--radius);
  }

  /* Drawn, not typed — the ╔═╗ frame and █▓▒░· comet were glyphs neither
     bundled face carries. The frame is now a real border. */
  .frame {
    display: flex;
    gap: 0.14em;
    padding: var(--pad-2) var(--pad-3);
    border: var(--panel-line);
    border-radius: var(--radius);
    user-select: none;
  }
  .cell {
    width: 0.4em;
    height: 0.9em;
    border-radius: 1px;
    background: color-mix(in srgb, var(--muted) 28%, transparent);
  }
  .cell.lit {
    background: color-mix(
      in srgb,
      var(--accent) calc(var(--heat) * 100%),
      color-mix(in srgb, var(--muted) 28%, transparent)
    );
  }

  .label {
    font-size: var(--fs-xs);
    letter-spacing: 0.14em;
    color: var(--text);
  }
</style>
