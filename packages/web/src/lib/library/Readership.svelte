<script lang="ts">
  import { api } from "../api";
  import { fmtDateTime } from "../dates";
  import { Icon, Modal } from "../tui";
  import type { Revision, ViewSummary } from "../types";
  import History, { revisionAuthor } from "./History.svelte";

  /**
   * Who has read one library item and who last changed it, as two lines in
   * the bottom-left corner of the page. Either line opens the item's versions.
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
  let latest = $state<Revision | null>(null);
  let open = $state(false);

  $effect(() => {
    const root = `/${base}/${id}`;
    void version;
    let live = true;
    api
      .get<ViewSummary>(`${root}/views`)
      .then((v) => live && (views = v))
      .catch(() => live && (views = null));
    api
      .get<Revision[]>(`${root}/revisions`)
      .then((r) => live && (latest = r[0] ?? null))
      .catch(() => live && (latest = null));
    return () => {
      live = false;
    };
  });

  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  const readLine = $derived(
    views
      ? [
          plural(views.views, "read", "reads") +
            (views.viewers ? ` by ${plural(views.viewers, "person", "people")}` : ""),
          views.last_viewed_at ? `last ${fmtDateTime(views.last_viewed_at)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "no reads yet",
  );

  const modifiedLine = $derived(
    latest
      ? `last modified ${fmtDateTime(latest.created_at)} by ${revisionAuthor(latest)}`
      : "versions",
  );
</script>

<div class="readership">
  <button
    class="line"
    title="versions"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <Icon name="eye" size="1.1em" weight={7} />
    <span>{readLine}</span>
  </button>
  <button
    class="line"
    title="versions"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <Icon name="history" size="1.1em" weight={7} />
    <span>{modifiedLine}</span>
  </button>
</div>

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
  /* margin-top: auto drops it to the foot of a page that fills its frame; a
     page taller than the frame just ends with it. */
  .readership {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pad-1);
    margin-top: auto;
    padding: var(--pad-4) 0 var(--pad-2) var(--pad-4);
  }
  .line {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  .line:hover {
    color: var(--text);
  }
  .line:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }
</style>
