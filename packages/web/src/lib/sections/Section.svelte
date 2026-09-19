<script lang="ts">
  import { onMount, untrack, type Component } from "svelte";
  import { Button, G, RAMP } from "../tui";
  import type { Spy } from "./spy.svelte";

  let {
    spy,
    section,
    label,
    view,
    eager = false,
    action,
  }: {
    spy: Spy;
    section: string;
    label: string;
    view: Component;
    /** Mount without waiting to be scrolled near. */
    eager?: boolean;
    action?: { label: string; run: () => void };
  } = $props();

  let el = $state<HTMLElement>();
  let head = $state<HTMLElement>();
  let live = $state(untrack(() => eager));

  onMount(() => {
    if (!el || !head) return;
    return spy.register(section, el, head, () => (live = true));
  });
</script>

<!-- Every section of the page is here at once; the rail indexes them rather
     than choosing between them. The heading sticks rather than being pinned by
     ScrollTrigger: a pin wraps the element in a spacer and re-measures on every
     refresh, and these sections grow for as long as their tables are loading. -->
<section bind:this={el} id="admin-{section}" aria-labelledby="head-{section}">
  <h2 class="head" bind:this={head} id="head-{section}">
    <span class="mark" aria-hidden="true">{G.marker}</span>
    <span class="lbl">{label}</span>
    <span class="rule" aria-hidden="true"></span>
    {#if action}
      <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={action.run}
        >{action.label}</Button
      >
    {/if}
  </h2>

  <div class="section-body">
    {#if live}
      {@const View = view}
      <View />
    {:else}
      <div class="stub" aria-hidden="true">
        {#each { length: 5 } as _, i}
          <span style="--w: {70 - i * 9}%">{RAMP[0].repeat(40)}</span>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  section {
    scroll-margin-top: var(--pad-2);
  }

  .head {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-3);
    padding: var(--pad-2) 0;
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: var(--label-spacing);
    /* --panel-bg, not --window-bg: the window's fill is deliberately a little
       transparent so a star can cross behind it, and rows scrolling under this
       heading showed straight through it. */
    background: var(--panel-bg);
  }
  /* A sticky box cannot rise above its containing block, and `main`'s content
     box starts one --main-air below the scrollport. So the heading pins that
     far down and rows scroll up through the strip above it. It carries its own
     ground up over that strip; `main`'s overflow clips the overshoot. The same
     trick, for the same reason, as .bar in LibraryView. */
  .head::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--main-air, 0.65rem);
    background: var(--panel-bg);
  }
  .mark {
    flex: none;
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .lbl {
    flex: none;
    min-width: 0;
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* Holds the section's place in the scroll until its panel arrives, so the
     rail's distances mean something before anything has loaded. */
  .stub {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    min-height: 14rem;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--border);
    letter-spacing: 0.35em;
    user-select: none;
  }
  .stub span {
    display: block;
    width: var(--w);
    overflow: hidden;
    white-space: nowrap;
  }
</style>
