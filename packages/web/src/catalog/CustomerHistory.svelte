<script lang="ts">
  import type { CustomerChangeBatch } from "@tachy/contract";
  import { actorTone } from "../library/History.svelte";
  import { Badge, Button, Modal, Note, Time } from "../tui";
  import { batchAuthor, batchText, changeText, fieldChanges } from "./customer";

  /**
   * "updated <date>" for a customer, as the way into their history: each
   * batch of changes opens to what it did field by field, and can be undone.
   */
  let {
    batches,
    canUndo,
    busy,
    error,
    nameOf,
    onundo,
  }: {
    /** Newest first. */
    batches: CustomerChangeBatch[];
    canUndo: boolean;
    busy: boolean;
    /** A refused undo, said inside the dialog. */
    error: string | null;
    /** The name an id column's value is shown by. */
    nameOf: (column: string, id: string) => string;
    onundo: (batchId: string) => void;
  } = $props();

  let open = $state(false);
  let expanded = $state<string | null>(null);
  const latest = $derived(batches[0]?.at ?? null);

  const toggle = (batchId: string) =>
    (expanded = expanded === batchId ? null : batchId);
</script>

{#if latest}
  <button class="updated" aria-haspopup="dialog" onclick={() => (open = true)}
    >updated <Time at={latest} date /></button
  >
{/if}

{#if open}
  <Modal
    title="history"
    cancelLabel="close"
    width="46rem"
    onCancel={() => (open = false)}
  >
    {#if error}<Note tone="danger">{error}</Note>{/if}
    <ul class="batches">
      {#each batches as batch (batch.batch_id)}
        <li>
          <button
            class="head"
            aria-expanded={expanded === batch.batch_id}
            onclick={() => toggle(batch.batch_id)}
          >
            <span class="at"><Time at={batch.at} /></span>
            <Badge tone={actorTone(batch.actor)}>{batch.actor}</Badge>
            <span class="what">{batchText(batch)}</span>
            <span class="who">{batchAuthor(batch)}</span>
          </button>
          {#if expanded === batch.batch_id}
            <div class="changes">
              {#each batch.changes as change, index (index)}
                {#if batch.changes.length > 1}
                  <p class="change">{changeText(change)}</p>
                {/if}
                <dl>
                  {#each fieldChanges(change, nameOf) as field (field.field)}
                    <dt>{field.field}</dt>
                    <dd>
                      {#if field.before !== null}<del>{field.before}</del>{/if}
                      {#if field.before !== null && field.after !== null}<span
                          class="to"
                          aria-label="became">→</span
                        >{/if}
                      {#if field.after !== null}<ins>{field.after}</ins>{/if}
                    </dd>
                  {/each}
                </dl>
              {/each}
              {#if canUndo}
                <Button
                  variant="ghost"
                  size="sm"
                  icon="reset"
                  {busy}
                  onclick={() => onundo(batch.batch_id)}
                  >undo this change</Button
                >
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </Modal>
{/if}

<style>
  .updated {
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  .updated:hover {
    color: var(--text);
  }
  .updated:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }
  .batches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    width: 100%;
    padding: var(--pad-1) var(--pad-2);
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .head:hover,
  .head[aria-expanded="true"] {
    border-left-color: var(--accent);
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .at {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  .who {
    flex: none;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .changes {
    padding: var(--pad-1) var(--pad-2) var(--pad-3) var(--pad-4);
  }
  .change {
    margin: var(--pad-2) 0 var(--pad-1);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  dl {
    display: grid;
    grid-template-columns: minmax(6rem, auto) minmax(0, 1fr);
    gap: 0.2rem var(--pad-3);
    margin: 0 0 var(--pad-2);
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
  del {
    color: var(--muted);
  }
  ins {
    text-decoration: none;
  }
  .to {
    margin: 0 var(--pad-1);
    color: var(--muted);
  }
</style>
