<script lang="ts">
  import { onMount } from "svelte";
  import { reducedMotion } from "../gsap";
  import { outlineTree, type OutlineItem, type OutlineNode } from "../outline";
  import { scrollport } from "../scrollport.svelte";
  import { G } from "../tui/glyphs";

  /**
   * An article's contents, in the left column the way the Arch Wiki keeps it:
   * numbered, top-level sections always shown, anything beneath them folded
   * until asked for. The branch you are reading opens itself as you scroll,
   * so the index says where you are without being told.
   *
   * Headings are looked up inside `.wiki-body` rather than by bare id: a
   * heading's id is derived from its text, and "Main content" would otherwise
   * find the app's own <main>.
   */
  let { items }: { items: OutlineItem[] } = $props();

  const tree = $derived(outlineTree(items));

  /** Branches opened or shut by hand. Everything else follows the scroll. */
  let toggled = $state<Record<string, boolean>>({});
  let active = $state<string | null>(null);

  /** The section being read and everything above it: the branch that opens. */
  const trail = $derived.by(() => {
    const open = new Set<string>();
    const walk = (nodes: OutlineNode[], above: string[]): boolean => {
      for (const n of nodes) {
        if (n.id === active) {
          for (const id of [...above, n.id]) open.add(id);
          return true;
        }
        if (walk(n.children, [...above, n.id])) return true;
      }
      return false;
    };
    walk(tree, []);
    return open;
  });

  const isOpen = (n: OutlineNode) => toggled[n.id] ?? trail.has(n.id);

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
  }

  function toTop(e: MouseEvent) {
    e.preventDefault();
    scrollport()?.scrollTo({
      top: 0,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    history.replaceState(history.state, "", location.pathname);
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
      if (!frame) frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    port.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      port.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
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
        <div class="row" class:on={n.id === active}>
          {#if n.children.length}
            <button
              class="fold"
              aria-expanded={open}
              aria-label="{open ? 'fold' : 'unfold'} {n.text}"
              onclick={() => (toggled = { ...toggled, [n.id]: !open })}
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

<nav class="contents" aria-label="Contents">
  <span class="cap">contents</span>
  <div class="row" class:on={active === null}>
    <span class="fold" aria-hidden="true"></span>
    <a href={location.pathname} onclick={toTop}>(top)</a>
  </div>
  {@render branch(tree)}
</nav>

<style>
  .contents {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--fs-sm);
  }
  .cap {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: var(--pad-1);
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
    color: var(--text);
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
    color: var(--muted);
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
