<script lang="ts">
  import { toneVar } from "./scale";
  import type { Tone } from "./tone";
  import { getView } from "./view";

  export type Unit = { key: string; label: string; tone: Tone; title?: string };
  export type UnitGroup = { key: string; label: string; items: Unit[] };

  let { groups }: { groups: UnitGroup[] } = $props();

  const view = getView();
</script>

<!--
@component
One cell per thing, coloured by its state: a handful of items read by looking,
with nothing to measure.
-->
<div class="units" class:big={view.expanded}>
  {#each groups as g (g.key)}
    <div class="group">
      <span class="name">{g.label}</span>
      <span class="cells">
        {#each g.items as u (u.key)}
          <span
            class="cell"
            style="--tone-color: {toneVar(u.tone)}"
            title={u.title ?? u.label}
            role="img"
            aria-label={u.title ?? u.label}
          ></span>
        {:else}
          <span class="none">none</span>
        {/each}
      </span>
    </div>
  {/each}
</div>

<style>
  .units {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--pad-4);
    width: 100%;
    --cell: 1.6rem;
  }
  .units.big {
    --cell: 2.2rem;
  }
  .group {
    display: grid;
    grid-template-columns: minmax(4rem, 22%) minmax(0, 1fr);
    align-items: start;
    gap: var(--pad-3);
  }
  .name {
    padding-top: 0.15rem;
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  .cells {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .cell {
    width: var(--cell);
    height: var(--cell);
    border-radius: 3px;
    background: var(--tone-color);
  }
  .none {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
