<script lang="ts">
  import { onMount } from "svelte";
  import { AUDIT_ACTIONS, MAX_PAGE, type AuditEventRow } from "@tachy/contract";
  import { api } from "../api";
  import { fmtDateTime } from "../dates.svelte";
  import { Button, DataTable, Select, type Column } from "../tui";
  import { detailText } from "./rows";

  let action = $state("");
  let events = $state<AuditEventRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // A short page is the last one; a full one may have more behind it.
  let more = $state(false);

  // One flexible column for what happened to what: the dialog has a fixed
  // width, and a detail column of its own pushed the table past it.
  const subject = (event: AuditEventRow) =>
    [event.target, detailText(event.detail)].filter(Boolean).join(" · ") || "-";

  const columns: Column<AuditEventRow>[] = [
    {
      key: "at",
      label: "when",
      width: "10rem",
      value: (e) => fmtDateTime(e.at),
    },
    {
      key: "actor_email",
      label: "who",
      width: "14rem",
      value: (e) => e.actor_email ?? "nobody signed in",
    },
    {
      key: "action",
      label: "action",
      width: "11rem",
      value: (e) => e.action.replaceAll("_", " "),
    },
    { key: "target", label: "on", value: subject },
    { key: "actor", label: "via", width: "4rem" },
    {
      key: "address",
      label: "from",
      width: "8rem",
      value: (e) => e.address ?? "-",
    },
  ];

  async function load(before?: string) {
    loading = true;
    error = null;
    try {
      const query = new URLSearchParams();
      if (action) query.set("action", action);
      if (before) query.set("before", before);
      const page = await api.get<AuditEventRow[]>(`/audit?${query}`);
      events = before ? [...events, ...page] : page;
      more = page.length === MAX_PAGE;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => void load());
</script>

<div class="bar">
  <Select
    bind:value={action}
    options={AUDIT_ACTIONS.map((a) => ({
      value: a,
      label: a.replaceAll("_", " "),
    }))}
    placeholder="any action"
    clearable
    searchable
    active={!!action}
    aria-label="filter by action"
    onchange={() => void load()}
  />
</div>

<DataTable
  {columns}
  rows={events}
  rowKey={(e) => e.id}
  {loading}
  {error}
  emptyTitle="Nothing recorded yet."
  emptyDetail="Sign-ins, account and credential changes, settings and exports are listed here."
/>

{#if more}
  <Button variant="ghost" size="sm" onclick={() => void load(events.at(-1)?.id)}
    >older events</Button
  >
{/if}

<style>
  .bar {
    margin-bottom: var(--pad-2);
  }
</style>
