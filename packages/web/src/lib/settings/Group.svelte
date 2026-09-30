<script lang="ts">
  import type { Snippet } from "svelte";
  import { G, Icon, type IconName } from "../tui";

  let {
    label,
    hint,
    icon,
    children,
  }: {
    label: string;
    hint?: string;
    /** Drawn in the marker's place. */
    icon?: IconName;
    children: Snippet;
  } = $props();
</script>

<!-- The admin section heading, unpinned: a settings tab is short enough that
     a heading which sticks would only ever cover the rows under it. The body
     is indented past the marker so its rows start under the heading's word,
     and runs to the end of the rule so their controls end under it. -->
<section style:--mark-w={icon ? "1em" : undefined}>
  <h2 class="head">
    <span class="mark" aria-hidden="true"
      >{#if icon}<Icon name={icon} size="1em" />{:else}{G.marker}{/if}</span
    >
    <span class="lbl">{label}</span>
    <span class="rule" aria-hidden="true"></span>
  </h2>
  <div class="body">
    {#if hint}<p class="hint">{hint}</p>{/if}
    {@render children()}
  </div>
</section>

<style>
  section {
    --mark-w: 0.7rem;
    --indent: calc(var(--mark-w) + var(--pad-2));
  }
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
    display: inline-flex;
    flex: none;
    width: var(--mark-w);
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
  .body {
    margin-top: var(--pad-2);
    padding-left: var(--indent);
  }
  .hint {
    margin: 0 0 var(--pad-2);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--muted);
  }
</style>
