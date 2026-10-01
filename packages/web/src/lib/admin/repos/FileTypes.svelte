<script lang="ts">
  import { DEFAULT_CODE_EXTENSIONS, type PreviewType } from "@tachy/contract";
  import FileIcon from "./FileIcon.svelte";
  import ToggleRow from "./ToggleRow.svelte";

  let {
    types,
    extensions,
    onchange,
  }: {
    types: PreviewType[];
    /** The repo's own list; null is the built-in set. */
    extensions: string[] | null;
    onchange: (extensions: string[]) => void;
  } = $props();

  /** The long tail of a vendored repo runs to dozens of types nobody reads. */
  const FIRST = 12;

  let all = $state(false);

  const chosen = $derived(
    new Set<string>(extensions ?? DEFAULT_CODE_EXTENSIONS),
  );
  const top = $derived(Math.max(1, ...types.map((t) => t.files)));
  const shown = $derived(all ? types : types.slice(0, FIRST));

  /* Starts from the whole effective set, built-in types this repo lacks
     included, so turning one type off does not quietly drop the rest. */
  function toggle(ext: string, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(ext);
    else next.delete(ext);
    onchange([...next].sort());
  }

  const fmt = (n: number) => n.toLocaleString();
</script>

<div class="types">
  {#each shown as t (t.ext)}
    {@const on = !t.binary && chosen.has(t.ext)}
    <ToggleRow
      checked={on}
      disabled={t.binary}
      label={t.ext ? `index .${t.ext} files` : "files with no extension"}
      about={t.binary
        ? t.ext
          ? "binary, never indexed"
          : "no extension, never indexed"
        : undefined}
      share={(on ? t.admitted : t.files) / top}
      count={on && t.admitted !== t.files
        ? `${fmt(t.admitted)} / ${fmt(t.files)}`
        : fmt(t.files)}
      onchange={(v) => toggle(t.ext, v)}
    >
      <FileIcon icon={t.icon} light={t.icon_light} />
      <span>{t.ext ? `.${t.ext}` : "no extension"}</span>
    </ToggleRow>
  {/each}
  {#if types.length > FIRST}
    <button class="more" onclick={() => (all = !all)}
      >{all ? "fewer" : `${types.length - FIRST} more types`}</button
    >
  {/if}
</div>

<style>
  .types {
    display: flex;
    flex-direction: column;
  }
  .more {
    align-self: flex-start;
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
