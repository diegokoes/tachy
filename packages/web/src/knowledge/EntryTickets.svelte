<script lang="ts">
  import type { EntryTicket } from "@tachy/contract";
  import { api } from "../api";
  import { chat } from "../chat/chatState.svelte";
  import { errText } from "../resource.svelte";
  import { navigate } from "../shell/router.svelte";
  import { Badge, Button, Note } from "../tui";
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
  }: {
    entryId: string;
    /** Reloads the list when the entry moves on. */
    version: number;
    canRemove: boolean;
    /** Offers the hand-off to the agent. */
    canUpdate: boolean;
  } = $props();

  let tickets = $state<EntryTicket[]>([]);
  let error = $state<string | null>(null);
  let removing = $state<string | null>(null);

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

  function updateWithAgent() {
    chat.input = entryUpdateCommand(entryId);
    navigate("/chat");
  }

  $effect(() => {
    void entryId;
    void version;
    load();
  });
</script>

{#if tickets.length || canUpdate}
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
