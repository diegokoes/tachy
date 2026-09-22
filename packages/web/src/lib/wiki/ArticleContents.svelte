<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "../gsap";
  import { outlineTree, type OutlineItem, type OutlineNode } from "../outline";
  import { scrollport } from "../scrollport.svelte";
  import { G } from "../tui/glyphs";

  /**
   * An article's contents, in the left column the way the Arch Wiki keeps it:
   * numbered and fully unfolded, with the section being read marked as you
   * scroll. Only the arrows fold a branch; following a link just scrolls.
   *
   * Headings are looked up inside `.wiki-body` rather than by bare id: a
   * heading's id is derived from its text, and "Main content" would otherwise
   * find the app's own <main>.
   */
  let { items }: { items: OutlineItem[] } = $props();

  const tree = $derived(outlineTree(items));

  /** Branches folded by hand; everything else stays open. */
  let folded = $state<Record<string, boolean>>({});
  let active = $state<string | null>(null);
  let nav = $state<HTMLElement>();

  /* While a click's smooth scroll is under way, the headings it passes are not
     where the reader is going: the section they picked holds until it lands. */
  let settling = 0;
  function settle() {
    clearTimeout(settling);
    settling = window.setTimeout(() => (settling = 0), 150);
  }

  const isOpen = (n: OutlineNode) => !folded[n.id];

  /* A long index scrolls in its own column, so the section being read has to be
     brought along; the page it belongs to is already in view, so "nearest"
     moves this column and nothing else. */
  $effect(() => {
    if (!active || !nav) return;
    nav
      .querySelector(`[data-row="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  const heading = (id: string) =>
    document.querySelector<HTMLElement>(`.wiki-body #${CSS.escape(id)}`);

  function go(e: MouseEvent, id: string) {
    e.preventDefault();
    const el = heading(id);
    if (!el) return;
    el.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    });
    history.replaceState(history.state, "", `#${id}`);
    active = id;
    settle();
  }

  function toTop(e: MouseEvent) {
    e.preventDefault();
    scrollport()?.scrollTo({
      top: 0,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    history.replaceState(history.state, "", location.pathname);
    active = null;
    settle();
  }

  /* The section in view is the last heading that has scrolled past a line a
     little below the top. Read on scroll rather than with an observer: a short
     section can cross the whole viewport between two intersection callbacks
     and never be reported as the one you are in. */
  $effect(() => {
    const port = scrollport();
    const ids = items.map((it) => it.id);
    if (!port || !ids.length) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line =
        port.getBoundingClientRect().top +
        Math.min(120, port.clientHeight * 0.25);
      let current: string | null = null;
      for (const id of ids) {
        const el = heading(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top > line) break;
        current = id;
      }
      active = current;
    };
    const onScroll = () => {
      if (settling) return settle();
      if (!frame) frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    port.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      port.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(settling);
    };
  });

  /* A link to a section, opened fresh, lands on it. */
  onMount(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    requestAnimationFrame(() => heading(id)?.scrollIntoView({ block: "start" }));
  });
</script>

{#snippet branch(nodes: OutlineNode[])}
  <ol>
    {#each nodes as n (n.id)}
      {@const open = isOpen(n)}
      <li>
        <div class="row" class:on={n.id === active} data-row={n.id}>
          {#if n.children.length}
            <button
              class="fold"
              aria-expanded={open}
              aria-label="{open ? 'fold' : 'unfold'} {n.text}"
              onclick={() => (folded = { ...folded, [n.id]: open })}
              >{open ? G.expanded : G.right}</button
            >
          {:else}
            <span class="fold" aria-hidden="true"></span>
          {/if}
          <a href="#{n.id}" onclick={(e) => go(e, n.id)}>
            <span class="no">{n.number}</span>
            <span class="txt">{n.text}</span>
          </a>
        </div>
        {#if n.children.length && open}{@render branch(n.children)}{/if}
      </li>
    {/each}
  </ol>
{/snippet}

<nav class="contents" aria-label="Contents" bind:this={nav}>
  <a class="cap" href={location.pathname} title="back to the top" onclick={toTop}
    >contents</a
  >
  {@render branch(tree)}
</nav>

<style>
  .contents {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--fs-sm);
    margin-top: var(--pad-3);
  }
  .cap {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: var(--pad-1);
    text-decoration: none;
    align-self: flex-start;
  }
  .cap:hover {
    color: var(--accent);
    text-decoration: none;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  ol ol {
    padding-left: 1.1em;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: var(--pad-1);
    min-width: 0;
    border-left: 2px solid transparent;
    padding: 0.1rem 0 0.1rem var(--pad-1);
  }
  /* Where you are: the accent edge Rail uses, not a highlight bar — the
     column is a reading aid and should not shout over the page. */
  .row.on {
    border-left-color: var(--accent);
  }
  .row.on a {
    font-weight: 700;
  }
  .fold {
    flex: none;
    width: 1em;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-family: var(--font-mono);
    color: var(--muted);
    cursor: pointer;
    text-align: left;
  }
  .fold:hover {
    color: var(--accent);
  }
  a {
    display: flex;
    gap: 0.5em;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
  a:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .no {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .txt {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
