<script lang="ts">
  import type { EntryTicket, SignalRow, SignalTicket } from "@tachy/contract";
  import { api } from "../api";
  import { chat } from "../chat/chatState.svelte";
  import { errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import { signalTickets, ticketRef } from "../review/signals";
  import { Badge, Button, Note, Time } from "../tui";
  import EntrySection from "./EntrySection.svelte";
  import { entryUpdateCommand } from "./tickets";

  /**
   * The tickets an entry draws on. Adding one is the agent's job: it reads the
   * ticket and changes the entry in the same step, so a ticket never sits on
   * the list without what it taught.
   */
  let {
    entryId,
    version,
    canRemove,
    canUpdate,
    recurrence,
  }: {
    entryId: string;
    /** Reloads the list when the entry moves on. */
    version: number;
    canRemove: boolean;
    /** Offers the hand-off to the agent. */
    canUpdate: boolean;
    /** What the sweep counted of later tickets that match the entry. */
    recurrence?: SignalRow;
  } = $props();

  let tickets = $state<EntryTicket[]>([]);
  let error = $state<string | null>(null);
  let removing = $state<string | null>(null);
  let linking = $state<string | null>(null);

  /** Matching tickets not on the list yet; the sweep's copy lags a link made here. */
  const matching = $derived(
    recurrence
      ? signalTickets(recurrence).filter(
          (match) =>
            !tickets.some(
              (ticket) => ticket.work_item_id === match.work_item_id,
            ),
        )
      : [],
  );

  async function load() {
    try {
      tickets = await api.get<EntryTicket[]>(`/knowledge/${entryId}/tickets`);
      error = null;
    } catch (e) {
      error = errText(e);
    }
  }

  async function remove(ticket: EntryTicket) {
    removing = ticket.work_item_id;
    try {
      tickets = await api.delete<EntryTicket[]>(
        `/knowledge/${entryId}/tickets/${ticket.work_item_id}`,
      );
      error = null;
    } catch (e) {
      error = errText(e);
    } finally {
      removing = null;
    }
  }

  async function link(match: SignalTicket) {
    linking = match.work_item_id;
    try {
      tickets = await api.post<EntryTicket[]>(`/knowledge/${entryId}/tickets`, {
        workItemId: match.work_item_id,
      });
      error = null;
    } catch (e) {
      error = errText(e);
    } finally {
      linking = null;
    }
  }

  function updateWithAgent() {
    chat.input = entryUpdateCommand(entryId, matching.map(ticketRef));
    navigate("/chat");
  }

  $effect(() => {
    void entryId;
    void version;
    load();
  });
</script>

{#if tickets.length || matching.length || canUpdate}
  <EntrySection label="tickets" compact>
    {#snippet action()}
      {#if canUpdate}
        <Button
          variant="ghost"
          size="sm"
          square
          icon="ai"
          title="update from a ticket"
          onclick={updateWithAgent}
        />
      {/if}
    {/snippet}
    {#if error}<Note tone="danger">{error}</Note>{/if}
    <ul>
      {#each tickets as ticket (ticket.work_item_id)}
        <li>
          <span class="ref">
            {#if ticket.external_url}
              <a
                href={ticket.external_url}
                target="_blank"
                rel="noopener noreferrer">#{ticket.external_id}</a
              >
            {:else}
              #{ticket.external_id}
            {/if}
          </span>
          <span class="title">{ticket.title ?? ""}</span>
          {#if ticket.is_source}
            <Badge>source</Badge>
          {:else if canRemove}
            <Button
              variant="ghost"
              size="sm"
              square
              icon="close"
              title="remove #{ticket.external_id}"
              busy={removing === ticket.work_item_id}
              onclick={() => remove(ticket)}
            />
          {/if}
        </li>
      {/each}
    </ul>
    {#if recurrence && matching.length}
      <p class="seen">
        seen on {recurrence.score} more
        {recurrence.score === 1 ? "ticket" : "tickets"}, last
        <Time at={recurrence.evidence.last_at} date />
      </p>
      <ul>
        {#each matching as match (match.work_item_id)}
          <li>
            <span class="ref">
              {#if match.url}
                <a href={match.url} target="_blank" rel="noopener noreferrer"
                  >#{match.external_id}</a
                >
              {:else}
                #{match.external_id}
              {/if}
            </span>
            <span class="title">{match.title ?? ""}</span>
            {#if canRemove}
              <Button
                variant="ghost"
                size="sm"
                square
                icon="plus"
                title="link #{match.external_id}"
                busy={linking === match.work_item_id}
                onclick={() => link(match)}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </EntrySection>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
    font-size: var(--fs-sm);
  }
  .seen {
    margin: var(--pad-2) 0 var(--pad-1);
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .ref {
    flex: none;
    font-family: var(--font-mono);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
</style>
