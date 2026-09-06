<script lang="ts">
  import { createSequence } from "../resource.svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { isCurator } from "../session.svelte";
  import { Button, Select } from "../tui";
  import type { Coverage, CoverageNode, NamedRow } from "../types";

  let { scope }: { scope: string } = $props();

  let data = $state<Coverage | null>(null);
  let error = $state<string | null>(null);
  let moving = $state<CoverageNode | null>(null);
  let moveTo = $state("");
  let busy = $state(false);

  $effect(() => {
    void scope;
    load();
  });

  const current = createSequence();

  async function load() {
    const isCurrent = current();
    error = null;
    try {
      const next = await api.get<Coverage>(`/library/wiki/${scope}/coverage`);
      if (!isCurrent()) return;
      data = next;
    } catch (e) {
      if (!isCurrent()) return;
      error = e instanceof Error ? e.message : String(e);
      data = null;
    }
  }

  /** Flat list of every node, for the "move under…" picker. */
  function flatten(nodes: CoverageNode[], depth = 0): { n: CoverageNode; depth: number }[] {
    return nodes.flatMap((n) => [
      { n, depth },
      ...flatten(n.children, depth + 1),
    ]);
  }
  const all = $derived(data ? flatten(data.nodes) : []);

  /** A node cannot move under itself or its own descendant. */
  function subtreeSlugs(n: CoverageNode): string[] {
    return [n.slug, ...n.children.flatMap(subtreeSlugs)];
  }

  async function move() {
    if (!moving) return;
    busy = true;
    error = null;
    try {
      await api.patch(`/library/wiki/${scope}/components/${moving.slug}`, {
        parentSlug: moveTo || null,
      });
      moving = null;
      moveTo = "";
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const drill = (n: CoverageNode) =>
    navigate(`/library/entries?component=${n.slug}`);

  /** What this node is asking for, if anything. */
  function gap(n: CoverageNode): string | null {
    if (n.subtree.articles === 0 && n.subtree.entries > 0)
      return `${n.subtree.entries} recorded, nothing written`;
    return null;
  }
</script>

{#snippet row(n: CoverageNode, depth: number)}
  <li style="--depth: {depth}" class:gap={!!gap(n)}>
    <div class="line">
      <button class="name" onclick={() => drill(n)}>{n.name}</button>

      <span class="counts" title="entries · docs · articles (this node)">
        {n.entries} · {n.docs} · {n.articles}
      </span>
      {#if n.children.length}
        <span class="sub" title="rolled up over the subtree">
          ({n.subtree.entries} · {n.subtree.docs} · {n.subtree.articles})
        </span>
      {/if}

      {#if n.subtree.reads}
        <span class="reads" title="reads">{n.subtree.reads}</span>
      {/if}

      {#if gap(n)}
        <span class="flag">{gap(n)}</span>
      {/if}

      {#if isCurator()}
        <button
          class="act"
          title="move under…"
          onclick={() => {
            moving = n;
            moveTo = "";
          }}>move</button>
      {/if}
    </div>
    {#if n.children.length}
      <ul>
        {#each n.children as child (child.id)}{@render row(child, depth + 1)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="coverage">
  <nav class="crumb">
    <a href="/library/wiki/{scope}" onclick={(e) => { e.preventDefault(); navigate(`/library/wiki/${scope}`); }}>
      {scope} wiki
    </a>
    <span class="sep">/</span>
    <span>Coverage</span>
  </nav>

  <h2>Coverage</h2>
  <p class="muted sm">
    What this product is made of, and how much of it has been written about.
    Counts are entries · docs · articles.
  </p>

  {#if error}<p class="err">{error}</p>{/if}

  {#if moving}
    <div class="mover">
      Move <strong>{moving.name}</strong> under
      <Select
        bind:value={moveTo}
        options={[
          { value: "", label: "(top level)" },
          ...all
            .filter(({ n }) => !subtreeSlugs(moving!).includes(n.slug))
            .map(({ n, depth }) => ({
              value: n.slug,
              label: `${"  ".repeat(depth)}${n.name}`,
            })),
        ]}
      />
      <Button size="sm" variant="primary" busy={busy} onclick={move}>move</Button>
      <Button size="sm" variant="ghost" onclick={() => (moving = null)}>cancel</Button>
    </div>
  {/if}

  {#if data}
    {#if data.nodes.length}
      <ul class="tree">
        {#each data.nodes as n (n.id)}{@render row(n, 0)}{/each}
      </ul>
    {:else}
      <p class="muted">
        This product has no components yet, so there is nothing to measure
        coverage against.
      </p>
    {/if}

    <section class="unfiled" class:loud={data.unfiled.entries > 0}>
      <h3>Filed under no component</h3>
      <p>
        {data.unfiled.entries} entries · {data.unfiled.docs} docs ·
        {data.unfiled.articles} articles
      </p>
      <p class="muted sm">
        If most of the corpus is here, the component tree is not describing it.
      </p>
    </section>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</div>

<style>
  .coverage {
    max-width: 70ch;
    margin: 0 auto;
  }
  .crumb {
    font-size: 0.85em;
    opacity: 0.7;
    margin-bottom: var(--pad-2);
  }
  .crumb a {
    color: inherit;
  }
  .crumb .sep {
    margin: 0 0.4rem;
    opacity: 0.5;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.15rem 0;
  }
  .tree > li > .line,
  li > ul > li > .line {
    padding-left: calc(var(--depth) * 1.2rem);
  }
  button.name {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    flex: 1;
    text-align: left;
  }
  button.name:hover {
    text-decoration: underline;
  }
  .counts {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .sub {
    font-variant-numeric: tabular-nums;
    opacity: 0.45;
    font-size: 0.9em;
  }
  .reads {
    opacity: 0.5;
    font-size: 0.85em;
  }
  /* The whole point of the screen: recorded lessons with nothing written. */
  .flag {
    color: var(--warn, orange);
    font-size: 0.8em;
    white-space: nowrap;
  }
  .act {
    background: none;
    border: none;
    font: inherit;
    font-size: 0.8em;
    opacity: 0.6;
    color: inherit;
    cursor: pointer;
  }
  .act:hover {
    opacity: 1;
    text-decoration: underline;
  }
  .mover {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: var(--pad-2) 0;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line, currentColor);
  }
  .unfiled {
    margin-top: var(--pad-4);
    border-top: 1px solid var(--line, currentColor);
    padding-top: var(--pad-2);
  }
  .unfiled h3 {
    font-size: 0.9em;
    margin: 0 0 0.2rem;
  }
  .unfiled p {
    margin: 0;
  }
  .unfiled.loud h3 {
    color: var(--warn, orange);
  }
  .muted {
    opacity: 0.6;
  }
  .sm {
    font-size: 0.85em;
  }
  .err {
    color: var(--bad, crimson);
  }
</style>
