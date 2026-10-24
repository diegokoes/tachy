<script lang="ts">
  import type { Snippet } from "svelte";
  import { ASCII_ART, type AsciiArt } from "./ascii";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";

  let {
    art,
    icon,
    title,
    detail,
    children,
  }: {
    /** A drawing of the place, in place of `icon`. */
    art?: AsciiArt;
    icon?: IconName;
    title: string;
    detail?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="empty">
  {#if art}
    <pre class="art" aria-hidden="true">{ASCII_ART[art].join("\n")}</pre>
  {:else if icon}<span class="ic"
      ><Icon name={icon} size="2.2em" weight={4} /></span
    >{/if}
  <p class="t">{title}</p>
  {#if detail}<p class="d">{detail}</p>{/if}
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-4) var(--pad-3);
    text-align: center;
  }
  .ic {
    color: var(--muted);
    opacity: 0.7;
    margin-bottom: var(--pad-2);
  }
  /* Line height 1, so the box-drawing strokes meet across lines. */
  .art {
    margin: 0 0 var(--pad-2);
    font-family: var(--font-mono);
    font-size: var(--fs-md);
    line-height: 1;
    color: var(--muted);
    opacity: 0.8;
  }
  .t {
    margin: 0;
    font-size: var(--fs-md);
  }
  .d {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
    max-width: 36ch;
  }
  .extra {
    margin-top: var(--pad-3);
  }
</style>
