<script lang="ts">
  import type { Snippet } from "svelte";
  import { navigate, segment } from "../router.svelte";
  import { Select } from "../tui";
  import { scopeOf, wikiLabel, wikiPath } from "./paths";
  import { wikis } from "./wikis.svelte";

  /**
   * Every reading page of the wiki: the switcher and whatever the page adds to
   * the left column, beside the page itself. The editor does not use it — it
   * needs the width more than the reader needs the index.
   */
  let {
    scope,
    aside,
    children,
  }: { scope: string; aside?: Snippet; children: Snippet } = $props();

  const options = $derived(
    wikis.rows.map((w) => ({
      value: scopeOf(w),
      label: w.open_gaps
        ? `${wikiLabel(w)} · ${w.open_gaps} ${w.open_gaps === 1 ? "gap" : "gaps"}`
        : wikiLabel(w),
    })),
  );

  /**
   * Contents and gaps exist in every wiki, so switching keeps you on them. An
   * article or a category is particular to one wiki, so switching from either
   * lands on the other wiki's main page.
   */
  function switchTo(next: string) {
    if (next === scope) return;
    const place = segment(2);
    navigate(
      place === "contents" || place === "gaps"
        ? wikiPath(next, place)
        : wikiPath(next),
    );
  }
</script>

<div class="wiki-root">
  <aside class="side">
    <div class="switch">
      <span class="cap">wiki</span>
      <Select
        value={scope}
        {options}
        title="switch wiki"
        aria-label="wiki"
        onchange={(v) => switchTo(String(v))}
      />
    </div>
    {#if aside}{@render aside()}{/if}
  </aside>

  <div class="page">{@render children()}</div>
</div>

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
    max-height: calc(100vh - 12rem);
    overflow-y: auto;
    scrollbar-width: thin;
    padding-block: var(--pad-2);
  }
  .switch {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .cap {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
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
      max-height: none;
      border-bottom: 1px solid var(--border);
      padding-bottom: var(--pad-3);
    }
  }
</style>
