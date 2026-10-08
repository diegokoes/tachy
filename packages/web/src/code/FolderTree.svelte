<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { PreviewDir } from "@tachy/contract";
  import { keep, recall } from "../shell/kept";
  import { Chevron, Icon } from "../tui";
  import { isGlob } from "./draft";
  import ToggleRow from "./ToggleRow.svelte";

  let {
    slug,
    dirs,
    admitted,
    exclude,
    onchange,
  }: {
    slug: string;
    dirs: PreviewDir[];
    /** Indexed files in the whole repo, which the top level is a share of. */
    admitted: number;
    exclude: string[];
    onchange: (exclude: string[]) => void;
  } = $props();

  /** Past this many folders under one parent, the rest wait behind a button. */
  const PAGE = 60;

  const parentOf = (path: string) =>
    path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

  const children = $derived.by(() => {
    const byParent = new Map<string, PreviewDir[]>();
    for (const dir of dirs) {
      const parentPath = parentOf(dir.path);
      const siblings = byParent.get(parentPath);
      if (siblings) siblings.push(dir);
      else byParent.set(parentPath, [dir]);
    }
    for (const siblings of byParent.values())
      siblings.sort(
        (a, b) => b.files - a.files || a.path.localeCompare(b.path),
      );
    return byParent;
  });
  const byPath = $derived(new Map(dirs.map((d) => [d.path, d])));

  const key = $derived(`admin.repo.${slug}.open`);
  const open = new SvelteSet<string>(untrack(() => recall<string[]>(key, [])));
  $effect(() => keep(key, [...open]));
  const more = new SvelteSet<string>();

  const plain = $derived(exclude.filter((p) => !isGlob(p)));
  const own = (path: string) => plain.includes(path);
  const inherited = (path: string) =>
    plain.some((p) => path.startsWith(`${p}/`));

  function toggle(path: string, on: boolean) {
    onchange(
      on
        ? exclude.filter((p) => p !== path)
        : [...exclude.filter((p) => !p.startsWith(`${path}/`)), path],
    );
  }

  const fmt = (n: number) => n.toLocaleString();
  const countOf = (d: PreviewDir) =>
    d.admitted === d.files || !d.admitted
      ? fmt(d.files)
      : `${fmt(d.admitted)} / ${fmt(d.files)}`;
</script>

{#snippet level(parent: string, depth: number)}
  {@const list = children.get(parent) ?? []}
  {@const whole = parent ? (byPath.get(parent)?.admitted ?? 0) : admitted}
  {#each more.has(parent) ? list : list.slice(0, PAGE) as dir (dir.path)}
    {@const kids = children.has(dir.path)}
    {@const expanded = kids && open.has(dir.path)}
    {@const locked = dir.skipped || inherited(dir.path)}
    {@const on = !locked && !own(dir.path)}
    <ToggleRow
      checked={on}
      disabled={locked}
      label={`index ${dir.path}`}
      {depth}
      share={on && whole ? dir.admitted / whole : 0}
      count={countOf(dir)}
      onchange={(v) => toggle(dir.path, v)}
    >
      {#snippet lead()}
        {#if kids}
          <button
            class="twist"
            aria-label="{expanded ? 'collapse' : 'expand'} {dir.path}"
            aria-expanded={expanded}
            onclick={() =>
              expanded ? open.delete(dir.path) : open.add(dir.path)}
            ><Chevron open={expanded} /></button
          >
        {:else}
          <span class="twist" aria-hidden="true"></span>
        {/if}
      {/snippet}
      {#snippet icon()}
        <Icon name={expanded ? "folderOpen" : "folder"} size="1em" />
      {/snippet}
      {nameOf(dir.path)}
    </ToggleRow>
    {#if expanded}{@render level(dir.path, depth + 1)}{/if}
  {/each}
  {#if list.length > PAGE && !more.has(parent)}
    <button class="more" style:--depth={depth} onclick={() => more.add(parent)}
      >{list.length - PAGE} more folders</button
    >
  {/if}
{/snippet}

<div class="tree">
  {@render level("", 0)}
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
  }
  .twist {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  button.twist:hover,
  button.twist:focus-visible {
    color: var(--accent);
  }
  .more {
    align-self: flex-start;
    margin-left: calc(var(--depth) * 1.1rem + 1.1rem);
    padding: var(--pad-1) 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more:hover {
    color: var(--accent);
  }
</style>
