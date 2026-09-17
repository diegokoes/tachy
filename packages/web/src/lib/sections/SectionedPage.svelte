<script lang="ts">
  import { onMount, tick, untrack, type Component } from "svelte";
  import { Rail } from "../tui";
  import { scrollport } from "../scrollport.svelte";
  import { createSpy, setActiveSpy } from "./spy.svelte";
  import Section from "./Section.svelte";

  export type PageSection = {
    key: string;
    label: string;
    view: Component;
    /** Shown on the rail row. null while it is still being counted. */
    count?: number | null;
    tone?: "warn" | "danger";
    /** Mount without waiting to be scrolled near. Overviews open their page. */
    eager?: boolean;
  };

  let {
    sections,
    label,
    at,
    onactive,
    page,
    active = $bindable(""),
  }: {
    sections: PageSection[];
    /** Names the rail for a screen reader — "connect sections". */
    label: string;
    /** The section to open at, from the URL. */
    at?: string;
    /** Called as the reader scrolls, so the caller can write the URL. */
    onactive?: (key: string) => void;
    /**
     * Changes when the whole column of sections is replaced. Admin passes its
     * page; a page whose sections never swap can leave it alone.
     */
    page?: string;
    /**
     * Which rail row is lit, readable by the caller. It follows the scroll, not
     * the route — the route is what the scroll writes. Rendering from the URL
     * instead would close the loop and re-render the page on every section the
     * reader passes.
     */
    active?: string;
  } = $props();

  const spy = createSpy({
    onactive: (key) => {
      active = key;
      onactive?.(key);
    },
    order: () => sections.map((s) => s.key),
  });

  const items = $derived(
    sections.map((s) => ({
      key: s.key,
      label: s.label,
      count: s.count,
      tone: s.tone,
    })),
  );

  /* Rebuilt per page, because the whole column of sections is replaced. `at` is
     read here and nowhere else — as a place to open at, not as a thing to
     render from. */
  $effect(() => {
    page;
    const open = untrack(() => at);
    let cancelled = false;
    tick().then(() => {
      if (cancelled) return;
      const first = sections[0]?.key ?? "";
      const target = sections.find((s) => s.key === open)?.key;
      /* The scroller is shared with every other view, so it still holds
         whatever the last page was scrolled to. Put it back at the top before
         the spy reads it, or arriving on a page lands halfway down it. */
      if (!target || target === first) {
        const port = scrollport();
        if (port) port.scrollTop = 0;
      }
      spy.start();
      active = target ?? first;
      if (target && target !== first) spy.goto(target, false);
    });
    return () => {
      cancelled = true;
      spy.destroy();
    };
  });

  /* Published for the overview figures, which scroll to the section that holds
     whatever number they are showing. */
  onMount(() => {
    const drop = setActiveSpy(spy);
    return () => {
      drop();
      spy.destroy();
    };
  });
</script>

<!-- The index and everything it points at, in one column. The rail's active row
     is still the heading of the part you are in — it just tracks the scroll
     instead of choosing what gets rendered at all. -->
<div class="page">
  <Rail {items} {active} {label} onpick={(k) => spy.goto(k)} />

  <div class="content">
    {#each sections as s (s.key)}
      <Section
        {spy}
        section={s.key}
        label={s.label}
        view={s.view}
        eager={s.eager}
      />
    {/each}

    <!-- Air under the last section so it can be scrolled to the top like any
         other. Blank space is the price; the rail landing somewhere different
         depending on how many rows the last table holds was the alternative. -->
    <div class="tail" style="height: {spy.tail}px" aria-hidden="true"></div>
  </div>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: minmax(9rem, 12rem) 1fr;
    gap: var(--pad-4);
    align-items: start;
    min-width: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
  }
  .tail {
    flex: none;
  }

  @media (max-width: 52rem) {
    .page {
      grid-template-columns: 1fr;
      gap: var(--pad-3);
    }
  }
</style>
