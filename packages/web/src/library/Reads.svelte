<script lang="ts">
  import { api } from "../api";
  import { fmtDateTime } from "../dates.svelte";
  import { Icon } from "../tui";
  import type { ViewSummary } from "./rows";

  /** Who has read one library item, as one line at the top of its page. */
  let {
    base,
    id,
    version,
    inline = false,
  }: {
    base: "knowledge" | "reference";
    id: string;
    /** Re-reads the count when the item changes under the page. */
    version?: number;
    /** Only the count, to sit in a line of other facts. */
    inline?: boolean;
  } = $props();

  let views = $state<ViewSummary | null>(null);

  $effect(() => {
    const path = `/${base}/${id}/views`;
    void version;
    let live = true;
    api
      .get<ViewSummary>(path)
      .then((v) => live && (views = v))
      .catch(() => live && (views = null));
    return () => {
      live = false;
    };
  });

  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  const count = $derived(
    views
      ? plural(views.views, "read", "reads") +
          (views.viewers
            ? ` by ${plural(views.viewers, "person", "people")}`
            : "")
      : "no reads yet",
  );
  const lastRead = $derived(
    views?.last_viewed_at ? `last ${fmtDateTime(views.last_viewed_at)}` : "",
  );
</script>

{#if inline}
  <span class="count">{count}</span>
{:else}
  <p class="reads">
    <Icon name="eye" size="1.1em" weight={7} />
    <span>{[count, lastRead].filter(Boolean).join(" · ")}</span>
  </p>
{/if}

<style>
  .count {
    color: var(--muted);
  }
  /* --reads-inset lines it up with what starts the page under it. */
  .reads {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0;
    padding: var(--pad-2) 0 0 var(--reads-inset, var(--pad-4));
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
