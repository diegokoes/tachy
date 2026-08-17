<script lang="ts">
  import type { Entry } from "../chatState.svelte";
  import { shatter } from "../motion";
  import { Button, Panel, G } from "../tui";

  type Approval = Extract<Entry, { kind: "approval" }>;

  let {
    entry,
    ondecide,
    oninspect,
  }: {
    entry: Approval;
    ondecide: (approve: boolean) => void;
    oninspect: () => void;
  } = $props();

  /** One-line preview; the full payload lives in the modal. */
  const peek = (s: string) =>
    s.replace(/\s+/g, " ").slice(0, 140) + (s.length > 140 ? "…" : "");
</script>

<div class="wrap">
  <Panel
    title={entry.tool}
    tone={entry.status === "denied"
      ? "danger"
      : entry.status === "approved"
        ? "accent"
        : "warn"}
  >
    {#snippet meta()}
      <span>{entry.status === "pending" ? "review & approve" : entry.status}</span>
    {/snippet}

    {#if entry.status === "denied"}
      <pre class="payload" use:shatter>{peek(entry.editable)}</pre>
    {:else}
      <button class="payload peek" title="View full payload" onclick={oninspect}>
        <span class="txt">{peek(entry.editable)}</span>
        <span class="view">⛶ view</span>
      </button>
    {/if}

    {#if entry.status === "pending"}
      <div class="acts">
        <Button
          variant="ghost"
          tone="danger"
          size="sm"
          icon="cancel"
          onclick={() => ondecide(false)}>deny</Button
        >
        <Button
          variant="ghost"
          tone="accent"
          size="sm"
          icon="save"
          onclick={() => ondecide(true)}>approve</Button
        >
      </div>
    {/if}
  </Panel>
</div>

<style>
  .wrap {
    max-width: 46rem;
    margin: var(--pad-2) 0;
  }

  .payload {
    display: flex;
    align-items: baseline;
    gap: var(--gap);
    width: 100%;
    margin: 0;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--muted);
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    overflow: hidden;
  }
  .peek {
    cursor: pointer;
  }
  .peek:hover {
    color: var(--text);
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .view {
    flex: none;
    color: var(--accent);
    font-size: var(--fs-xs);
  }

  .acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--pad-2);
    margin-top: var(--pad-3);
  }
</style>
