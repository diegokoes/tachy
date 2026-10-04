<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { pushScope } from "../keys/keys.svelte";
  import { createResource } from "../resource.svelte";
  import { navigate, segments } from "../shell/router.svelte";
  import { t } from "../terms";
  import { Note, Treemap, hottest, toneMix } from "../tui";
  import { RAMP_STEPS } from "../tui/scale";
  import { coverageTree, trailTo } from "./coverage";
  import type { ComponentCoverage } from "./rows";

  const BASE = "/admin/structure/map";

  const coverage = createResource(
    () => api.get<ComponentCoverage[]>("/overview/components"),
    [],
  );

  const whole = $derived(coverageTree(coverage.data, `all ${t("products")}`));
  const trail = $derived(trailTo(whole, segments().slice(3).join("/")));
  const shown = $derived(trail[trail.length - 1]);
  const top = $derived(hottest(whole));

  /* The zoom is the route, so the browser's back is a zoom out and a view
     of one product can be linked. */
  const zoom = (key: string) => navigate(key ? `${BASE}/${key}` : BASE);

  onMount(() => {
    void coverage.reload();
    return pushScope([
      {
        key: "esc",
        label: "zoom out",
        run: () =>
          trail.length > 1
            ? zoom(trail[trail.length - 2].key)
            : navigate("/admin/structure"),
      },
    ]);
  });
</script>

<div class="stage">
  <div class="bar">
    <nav class="trail" aria-label="zoom">
      {#each trail as b, i (b.key)}
        {#if i}<span class="sep">›</span>{/if}
        {#if i < trail.length - 1}
          <button type="button" onclick={() => zoom(b.key)}>{b.label}</button>
        {:else}
          <span class="here">{b.label}</span>
        {/if}
      {/each}
    </nav>
    <span class="legend">
      <span class="swatch hollow"></span>0
      {#each RAMP_STEPS as s (s)}
        <span class="swatch" style="background: {toneMix('accent', s)}"></span>
      {/each}
      {top} searchable
    </span>
  </div>

  {#if coverage.error}<Note tone="danger">{coverage.error}</Note>{/if}

  <div class="plot">
    {#if shown.children?.length}
      <Treemap root={shown} max={top} onpick={(b) => zoom(b.key)} />
    {:else if !coverage.loading}
      <span class="empty">no components yet</span>
    {/if}
  </div>
</div>

<style>
  .stage {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    padding: var(--view-pad-y) var(--view-pad-x);
  }

  .bar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-4);
    padding-bottom: var(--pad-2);
    border-bottom: 1px solid color-mix(in srgb, var(--muted) 45%, transparent);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .trail {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--pad-2);
    min-width: 0;
  }
  .trail button {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .trail button:hover,
  .trail button:focus-visible {
    color: var(--text);
    text-decoration: underline;
  }
  .here {
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--text);
  }

  .legend {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .swatch {
    width: 0.9em;
    height: 0.9em;
    border-radius: 1px;
  }
  .swatch.hollow {
    margin-right: 0.5ch;
    border: 1px dashed color-mix(in srgb, var(--muted) 55%, transparent);
  }
  .swatch:last-of-type {
    margin-right: 0.5ch;
  }

  .plot {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
  }
  .empty {
    margin: auto;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
