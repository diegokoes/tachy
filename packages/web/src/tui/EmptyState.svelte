<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";

  let {
    icon,
    title,
    detail,
    children,
  }: {
    icon?: IconName;
    title: string;
    detail?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="empty">
  {#if icon}<span class="ic"><Icon name={icon} size="2.2em" weight={4} /></span
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
