<script lang="ts">
  import type { Snippet } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { scrollport } from "../scrollport.svelte";
  import { pushScope } from "../keys.svelte";
  import { Select } from "../tui";
  import { scopeOf, wikiLabel, wikiPath } from "./paths";
  import { wikis } from "./wikis.svelte";
  import WikiSearch from "./WikiSearch.svelte";

  /**
   * Every reading page of the wiki: the switcher and whatever the page adds to
   * the left column, beside the page itself. `lead` sits above the switcher and
   * stays put with it; `aside` scrolls beneath. The editor does not use it — it
   * needs the width more than the reader needs the index.
   */
  let {
    scope,
    lead,
    aside,
    children,
  }: {
    scope: string;
    lead?: Snippet;
    aside?: Snippet;
    children: Snippet;
  } = $props();

  /* The switcher doubles as the wiki index, so each row carries its size — how
     many articles, and how many open gaps when there are any. */
  const options = $derived(
    wikis.rows.map((w) => ({
      value: scopeOf(w),
      label:
        wikiLabel(w) +
        (w.articles ? ` (${w.articles})` : "") +
        (w.open_gaps ? ` · ${w.open_gaps} gap${w.open_gaps === 1 ? "" : "s"}` : ""),
    })),
  );

  /**
   * Gaps exists in every wiki, so switching keeps you there. An article or a
   * section is particular to one wiki, so switching from either lands on the
   * other wiki's landing.
   */
  let rootEl = $state<HTMLDivElement>();

  /* The column is as tall as what scrolls beside it. A viewport-height guess
     would stop short of the page's last line, by however much chrome sits
     above the scroller. */
  $effect(() => {
    const port = scrollport();
    const root = rootEl;
    if (!port || !root) return;
    const ro = new ResizeObserver(() =>
      root.style.setProperty("--port-h", `${port.clientHeight}px`),
    );
    ro.observe(port);
    return () => ro.disconnect();
  });

  function switchTo(next: string) {
    if (next === scope) return;
    const place = segment(2);
    navigate(place === "gaps" ? wikiPath(next, place) : wikiPath(next));
  }

  /* Every reading page of the wiki gets its own quick-find, the way Components
     does — scoped to this wiki rather than the whole library. */
  let searching = $state(false);
  $effect(() =>
    pushScope([
      {
        key: "ctrl+k",
        label: "search wiki",
        inFields: true,
        run: () => (searching = true),
      },
    ]),
  );
</script>

<div class="wiki-root" bind:this={rootEl}>
  <aside class="side">
    {#if lead}{@render lead()}{/if}
    <div class="switch">
      <Select
        value={scope}
        {options}
        title="switch wiki"
        aria-label="wiki"
        searchable
        filterPlaceholder="filter wikis…"
        onchange={(v) => switchTo(String(v))}
      />
    </div>
    {#if aside}<div class="rest">{@render aside()}</div>{/if}
  </aside>

  <div class="page">{@render children()}</div>
</div>

{#if searching}
  <WikiSearch {scope} onClose={() => (searching = false)} />
{/if}

<style>
  /* The same two columns admin reads by: the index stays put, the page
     scrolls past it. */
  .wiki-root {
    display: grid;
    grid-template-columns: minmax(11rem, 16rem) minmax(0, 1fr);
    gap: var(--pad-4);
    align-items: start;
    min-width: 0;
  }
  .side {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
    height: calc(var(--port-h, 100vh) - var(--main-air, 0px) * 2);
    padding-block: var(--pad-2);
  }
  .switch {
    display: flex;
    flex-direction: column;
  }
  /* Only the index scrolls, so the column's head can carry something that
     arrives from outside it without being clipped on the way in. */
  .rest {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .page {
    min-width: 0;
  }

  @media (max-width: 52rem) {
    .wiki-root {
      grid-template-columns: 1fr;
      gap: var(--pad-3);
    }
    .side {
      position: static;
      height: auto;
    }
    .rest {
      overflow: visible;
      border-bottom: 1px solid var(--border);
      padding-bottom: var(--pad-3);
    }
  }
</style>
