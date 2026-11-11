<script lang="ts">
  import type { SignalRow, SignalTicket } from "@tachy/contract";
  import { api } from "../api";
  import { chat } from "../chat/chatState.svelte";
  import { entryUpdateCommand } from "../knowledge/tickets";
  import { errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import { Badge, Button, Note, Time } from "../tui";
  import {
    SIGNAL_LABELS,
    settledByTicket,
    signalLine,
    signalTickets,
    ticketRef,
  } from "./signals";

  let { signal, onChanged }: { signal: SignalRow; onChanged: () => void } =
    $props();

  let error = $state<string | null>(null);
  let acting = $state<string | null>(null);
  /** Tickets linked from here, which the list still names until the next sweep. */
  let linked = $state<string[]>([]);

  const entryPath = $derived(`/library/entries/${signal.knowledge_entry_id}`);
  const tickets = $derived(
    signalTickets(signal).filter(
      (ticket) => !linked.includes(ticket.work_item_id),
    ),
  );
  const twin = $derived(signal.evidence.twin);

  async function run(action: string, request: () => Promise<unknown>) {
    acting = action;
    error = null;
    try {
      await request();
      return true;
    } catch (e) {
      error = errText(e);
      return false;
    } finally {
      acting = null;
    }
  }

  async function settle(action: "dismiss" | "mute") {
    const settled = await run(action, () =>
      api.post(`/review/signals/${signal.id}/${action}`, {}),
    );
    if (settled) onChanged();
  }

  async function link(ticket: SignalTicket) {
    const added = await run(ticket.work_item_id, () =>
      api.post(`/knowledge/${signal.knowledge_entry_id}/tickets`, {
        workItemId: ticket.work_item_id,
      }),
    );
    if (added) linked.push(ticket.work_item_id);
  }

  /**
   * Hands the entry and its tickets to the agent, in the composer and not
   * sent: the update still passes the chat's own review box.
   */
  function draftUpdate() {
    chat.input = entryUpdateCommand(
      signal.knowledge_entry_id,
      tickets.map(ticketRef),
    );
    navigate("/chat");
  }

  const open = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };
</script>

<article class="signal">
  {#if error}<Note tone="danger">{error}</Note>{/if}
  <header>
    <h2>
      <a href={entryPath} onclick={open(entryPath)}>{signal.entry_title}</a>
    </h2>
    <p class="facts">
      <Badge tone="warn">{SIGNAL_LABELS[signal.kind]}</Badge>
      <span>{signalLine(signal)}</span>
    </p>
    <p class="facts">
      seen since <Time at={signal.first_seen_at} date />
      {#if signal.dismissed_at}
        · back after being dismissed at {signal.dismissed_score}
      {/if}
    </p>
  </header>

  {#if tickets.length}
    <ul class="evidence">
      {#each tickets as ticket (ticket.work_item_id)}
        <li>
          <span class="ref">
            {#if ticket.url}
              <a href={ticket.url} target="_blank" rel="noopener noreferrer"
                >#{ticket.external_id}</a
              >
            {:else}
              #{ticket.external_id}
            {/if}
          </span>
          <span class="title">{ticket.title ?? ""}</span>
          {#if signal.kind === "recurring"}
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              busy={acting === ticket.work_item_id}
              onclick={() => link(ticket)}>link</Button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if signal.evidence.notes?.length}
    <ul class="evidence">
      {#each signal.evidence.notes as note}
        <li>
          <Badge>{note.kind}</Badge>
          <span class="said">{note.comment ?? ""}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if twin}
    {@const twinPath = `/library/entries/${twin.id}`}
    <p class="facts">
      the older entry:
      <a href={twinPath} onclick={open(twinPath)}>{twin.title}</a>
    </p>
  {/if}

  <div class="acts">
    <Button icon="knowledge" onclick={() => navigate(entryPath)}
      >open entry</Button
    >
    {#if settledByTicket(signal) && tickets.length}
      <Button icon="ai" tone="accent" onclick={draftUpdate}>draft update</Button
      >
    {/if}
    <Button
      icon="close"
      busy={acting === "dismiss"}
      onclick={() => settle("dismiss")}>dismiss</Button
    >
    {#if signal.kind === "recurring"}
      <Button
        variant="ghost"
        icon="archive"
        busy={acting === "mute"}
        onclick={() => settle("mute")}>known recurring</Button
      >
    {/if}
  </div>
</article>

<style>
  .signal {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-width: 0;
    max-width: 88ch;
  }
  h2 {
    font-size: var(--fs-lg);
    margin: 0 0 var(--pad-2);
  }
  h2 a {
    color: inherit;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-1);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .evidence {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .evidence li {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
    padding: var(--pad-1) 0;
    border-bottom: 1px solid var(--border);
  }
  .ref {
    flex: none;
    font-family: var(--font-mono);
  }
  .title,
  .said {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-2);
  }
</style>
