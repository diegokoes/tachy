<script lang="ts">
  import type { CustomerFiled } from "@tachy/contract";
  import { link } from "../shell/router.svelte";
  import Group from "../settings/Group.svelte";
  import { Badge, Icon } from "../tui";

  let {
    entries,
    current,
    unitName,
    onlibrary,
  }: {
    entries: CustomerFiled["entries"];
    /** The unit in view, whose own entries need no "on" line; null for the customer. */
    current: string | null;
    unitName: (slug: string) => string;
    /** Opens the library on the same entries, with its filters to go further. */
    onlibrary: () => void;
  } = $props();
</script>

<Group label="entries">
  {#each entries as entry (entry.id)}
    <div class="item">
      <Icon name="knowledge" size="1em" />
      <a href="/library/entries/{entry.id}" use:link>{entry.title}</a>
      {#if entry.status !== "approved"}<Badge>{entry.status}</Badge>{/if}
      {#if entry.unit && entry.unit !== current}
        <span class="where">on {unitName(entry.unit)}</span>
      {/if}
    </div>
  {/each}
  <button class="more" onclick={onlibrary}>open in the library ›</button>
</Group>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) 0;
  }
  .where {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .more {
    margin-top: var(--pad-2);
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--accent);
    cursor: pointer;
  }
  .more:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
