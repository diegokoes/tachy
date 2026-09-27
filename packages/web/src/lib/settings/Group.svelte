<script lang="ts">
  import type { Snippet } from "svelte";
  import { G } from "../tui";

  let {
    label,
    hint,
    children,
  }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- The admin section heading, unpinned: a settings tab is short enough that
     a heading which sticks would only ever cover the rows under it. -->
<section>
  <h2 class="head">
    <span class="mark" aria-hidden="true">{G.marker}</span>
    <span class="lbl">{label}</span>
    <span class="rule" aria-hidden="true"></span>
  </h2>
  {#if hint}<p class="hint">{hint}</p>{/if}
  <div class="body">{@render children()}</div>
</section>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0;
    padding: var(--pad-2) 0;
    font-size: var(--fs-sm);
    font-weight: 500;
    letter-spacing: var(--label-spacing);
  }
  .mark {
    flex: none;
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .lbl {
    flex: none;
    font-weight: 600;
    text-transform: uppercase;
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .hint {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .body {
    margin-top: var(--pad-2);
  }
</style>
