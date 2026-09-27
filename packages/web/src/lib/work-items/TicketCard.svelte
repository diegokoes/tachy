<script lang="ts">
  import type { CreatedTicket } from "@tachy/contract";
  import { Icon } from "../tui";
  import { typeColor, typeIcon } from "./ado-icons";

  let {
    ticket,
    icon,
    color,
  }: { ticket: CreatedTicket; icon: string | null; color: string | null } =
    $props();
</script>

<a class="ticket" href={ticket.url} target="_blank" rel="noopener noreferrer">
  <span class="glyph" style:color={typeColor(color) ?? undefined}>
    <Icon name={typeIcon(icon)} size="1.1em" />
  </span>
  <span class="id">#{ticket.id}</span>
  <span class="title">{ticket.title}</span>
  <span class="meta">{ticket.type} · {ticket.project}</span>
  <Icon name="next" size="1em" />
</a>

<style>
  .ticket {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0.4rem 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
  }
  .ticket:hover,
  .ticket:focus-visible {
    border-color: var(--accent);
  }
  .glyph {
    display: inline-flex;
    color: var(--muted);
  }
  .id {
    color: var(--accent);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
