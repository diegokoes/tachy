<script lang="ts">
  import { api } from "../api";
  import { fmtDateTime } from "../dates";
  import { Icon, Modal } from "../tui";
  import type { ViewSummary } from "../types";
  import History from "./History.svelte";

  /**
   * Read counts for one library item, drawn as a line under its content. The
   * line opens the item's versions.
   */
  let {
    base,
    id,
    version,
    canEdit = false,
    onReverted,
  }: {
    base: "knowledge" | "reference";
    id: string;
    version?: number;
    canEdit?: boolean;
    onReverted?: () => void;
  } = $props();

  let views = $state<ViewSummary | null>(null);
  let open = $state(false);

  $effect(() => {
    const url = `/${base}/${id}/views`;
    void version;
    let live = true;
    api
      .get<ViewSummary>(url)
      .then((v) => live && (views = v))
      .catch(() => live && (views = null));
    return () => {
      live = false;
    };
  });

  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  const line = $derived(
    views
      ? [
          plural(views.views, "read", "reads") +
            (views.viewers ? ` by ${plural(views.viewers, "person", "people")}` : ""),
          views.last_viewed_at ? `last ${fmtDateTime(views.last_viewed_at)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "versions",
  );
</script>

<button
  class="reads"
  title="versions"
  aria-haspopup="dialog"
  onclick={() => (open = true)}
>
  <Icon name="history" size="1.1em" weight={7} />
  <span>{line}</span>
</button>

{#if open}
  <Modal
    title="versions"
    cancelLabel="close"
    width="46rem"
    onCancel={() => (open = false)}
  >
    <History {base} {id} {version} {canEdit} {onReverted} />
  </Modal>
{/if}

<style>
  .reads {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    align-self: flex-start;
    margin-top: var(--pad-4);
    padding: var(--pad-1) 0;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  .reads:hover {
    color: var(--text);
  }
  .reads:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }
</style>
