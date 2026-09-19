<script lang="ts">
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { errText } from "../resource.svelte";
  import { isCurator } from "../session.svelte";
  import { Button, Note, Select } from "../tui";
  import { presetScope } from "../library/filters";
  import type { Coverage, CoverageNode } from "../types";
  import { flattenTree, subtreeSlugs } from "./tree";

  /**
   * What the product is made of and how much of each part has been written
   * about. A report over the component tree — deliberately not the wiki's
   * navigation, which is its categories — and the ground the gap list above it
   * was measured against.
   */
  let {
    scope,
    coverage,
    onchanged,
  }: { scope: string; coverage: Coverage; onchanged: () => void } = $props();

  let moving = $state<CoverageNode | null>(null);
  let moveTo = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const all = $derived(flattenTree(coverage.nodes));

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
      onchanged();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  /** Everything recorded under this part, in the library's own list. */
  function drill(n: CoverageNode) {
    presetScope({ product: scope, component: n.slug });
    navigate("/library/entries");
  }
</script>

{#snippet row(n: CoverageNode, depth: number)}
  <li style="--depth: {depth}">
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
        <span class="reads" title="reads">{n.subtree.reads} reads</span>
      {/if}
      {#if isCurator()}
        <button
          class="act"
          title="move under…"
          onclick={() => {
            moving = n;
            moveTo = "";
          }}>move</button
        >
      {/if}
    </div>
    {#if n.children.length}
      <ul>
        {#each n.children as child (child.id)}{@render row(child, depth + 1)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<section class="coverage">
  <h3>Coverage</h3>
  <p class="muted sm">
    What this product is made of, and how much of it has been written about.
    Counts are entries · docs · articles; a name opens what is recorded there.
  </p>

  {#if error}<Note tone="danger">{error}</Note>{/if}

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
      <Button size="sm" variant="primary" {busy} onclick={move}>move</Button>
      <Button size="sm" variant="ghost" onclick={() => (moving = null)}
        >cancel</Button
      >
    </div>
  {/if}

  {#if coverage.nodes.length}
    <ul class="tree">
      {#each coverage.nodes as n (n.id)}{@render row(n, 0)}{/each}
    </ul>
  {:else}
    <p class="muted">
      This product has no components yet, so there is nothing to measure
      coverage against.
    </p>
  {/if}

  <p class="unfiled" class:loud={coverage.unfiled.entries > 0}>
    Filed under no component: {coverage.unfiled.entries} entries ·
    {coverage.unfiled.docs} docs · {coverage.unfiled.articles} articles
    <span class="muted">
      · a high count means the component tree is incomplete
    </span>
  </p>
</section>

<style>
  .coverage {
    margin-top: var(--pad-4);
    border-top: 1px solid var(--border);
    padding-top: var(--pad-3);
  }
  h3 {
    font-size: var(--fs-sm);
    margin: 0 0 var(--pad-1);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tree {
    margin-top: var(--pad-2);
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.15rem 0 0.15rem calc(var(--depth) * 1.2rem);
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
  }
  .sub,
  .reads {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .act {
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  .act:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .mover {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: var(--pad-2) 0;
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .unfiled {
    margin: var(--pad-3) 0 0;
    font-size: var(--fs-sm);
  }
  .unfiled.loud {
    color: var(--warn);
  }
  .muted {
    color: var(--muted);
  }
  .sm {
    font-size: var(--fs-sm);
  }
</style>
