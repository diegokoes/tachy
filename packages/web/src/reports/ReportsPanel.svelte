<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { refreshNotifications, toast } from "../notifications/notify.svelte";
  import { Badge, Button, Note, Icon, EmptyState } from "../tui";
  import { age } from "../admin/overview";
  import { census } from "../admin/census.svelte";
  import {
    REPORT_STATUSES,
    type ReportRow,
    type ReportStatus,
    type ReportType,
  } from "@tachy/contract";

  let reports = $state<ReportRow[]>([]);
  let selected = $state<ReportRow | null>(null);
  let filter = $state<ReportStatus | "all">("open");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let reply = $state("");
  let busy = $state(false);

  const STATUS_TONE: Record<ReportStatus, "warn" | "accent" | "ok" | "muted"> =
    {
      open: "warn",
      in_progress: "accent",
      resolved: "ok",
      closed: "muted",
    };
  const typeTone = (t: ReportType) => (t === "bug" ? "danger" : "accent");

  async function loadList() {
    loading = true;
    error = null;
    try {
      const query = filter === "all" ? "" : `?status=${filter}`;
      reports = await api.get<ReportRow[]>(`/reports/all${query}`);
      if (selected && !reports.some((r) => r.id === selected!.id))
        selected = null;
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function open(id: string) {
    error = null;
    try {
      selected = await api.get<ReportRow>(`/reports/${id}`);
      reply = "";
    } catch (e) {
      error = errText(e);
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    busy = true;
    error = null;
    try {
      await api.post(`/reports/${selected.id}/reply`, { body: reply.trim() });
      await open(selected.id);
      toast("reply sent - the reporter will be notified", "ok");
      // An admin answering their own report is the reporter it notifies.
      void refreshNotifications();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  async function setStatus(status: ReportStatus) {
    if (!selected || selected.status === status) return;
    busy = true;
    error = null;
    try {
      const updated = await api.put<ReportRow>(
        `/reports/${selected.id}/status`,
        { status },
      );
      selected = { ...selected, status: updated.status };
      await loadList();
      void census.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    filter;
    void loadList();
  });

  onMount(loadList);
</script>

<div class="reports">
  <div class="pane list">
    <div class="filters">
      {#each ["open", "in_progress", "resolved", "closed", "all"] as choice}
        <button
          class="filter"
          class:on={filter === choice}
          onclick={() => (filter = choice as ReportStatus | "all")}
        >
          {choice.replace("_", " ")}
        </button>
      {/each}
    </div>

    {#if error && !selected}<Note tone="danger">{error}</Note>{/if}

    {#if loading}
      <p class="dim">loading…</p>
    {:else if reports.length === 0}
      <EmptyState icon="flag" title="nothing here" />
    {:else}
      <ul class="rows">
        {#each reports as report (report.id)}
          <li>
            <button
              class="row"
              class:on={selected?.id === report.id}
              onclick={() => open(report.id)}
            >
              <span class="ico"
                ><Icon
                  name={report.type === "bug" ? "bug" : "lightbulb"}
                  size="1em"
                  weight={7}
                /></span
              >
              <span class="who">
                <span class="ttl"
                  >{report.title || report.body_text.slice(0, 60)}</span
                >
                <span class="meta">
                  {report.reporter_name ?? "someone"} · {age(report.created_at)} ago
                </span>
              </span>
              <Badge tone={STATUS_TONE[report.status]}
                >{report.status.replace("_", " ")}</Badge
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="pane detail">
    {#if !selected}
      <EmptyState icon="flag" title="pick a report" />
    {:else}
      {@const open = selected}
      <div class="head">
        <Badge tone={typeTone(open.type)}>{open.type}</Badge>
        <h3 class="ttl">{open.title || "untitled report"}</h3>
      </div>
      <p class="sub">
        from {open.reporter_name ?? "someone"} · {age(open.created_at)} ago
      </p>

      <p class="body">{open.body_text}</p>

      {#if open.ai_review && open.ai_review.suggestions.length}
        <Note tone="muted">
          AI review flagged: {open.ai_review.suggestions.join("; ")}
        </Note>
      {/if}

      {#if open.messages && open.messages.length}
        <div class="thread">
          {#each open.messages as message (message.id)}
            <div class="msg {message.direction}">
              <span class="from"
                >{message.direction === "admin"
                  ? (message.author_name ?? "admin")
                  : (open.reporter_name ?? "reporter")}</span
              >
              <p>{message.body_text}</p>
            </div>
          {/each}
        </div>
      {/if}

      {#if error}<Note tone="danger">{error}</Note>{/if}

      <div class="reply">
        <textarea
          rows="3"
          placeholder="reply to the reporter…"
          bind:value={reply}></textarea>
        <div class="actions">
          <div class="statuses">
            {#each REPORT_STATUSES as status}
              <button
                class="status"
                class:on={open.status === status}
                disabled={busy}
                onclick={() => setStatus(status)}
              >
                {status.replace("_", " ")}
              </button>
            {/each}
          </div>
          <Button
            variant="primary"
            icon="send"
            {busy}
            disabled={busy || !reply.trim()}
            onclick={sendReply}
          >
            reply
          </Button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .reports {
    display: grid;
    grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
    gap: var(--pad-4);
    min-height: 0;
  }
  @media (max-width: 52rem) {
    .reports {
      grid-template-columns: 1fr;
    }
  }

  .pane {
    min-width: 0;
  }
  .detail {
    border-left: var(--panel-line);
    padding-left: var(--pad-4);
  }
  @media (max-width: 52rem) {
    .detail {
      border-left: none;
      padding-left: 0;
    }
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
    margin-bottom: var(--pad-3);
  }
  .filter,
  .status {
    font: inherit;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
    cursor: pointer;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-chip);
    padding: var(--pad-1) var(--pad-2);
  }
  .filter.on,
  .status.on {
    color: var(--accent);
    border-color: var(--accent);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    text-align: left;
    font: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    padding: var(--pad-2);
    color: var(--text);
  }
  .row:hover {
    background: color-mix(in srgb, var(--muted) 10%, transparent);
  }
  .row.on {
    border-color: var(--accent);
  }
  .row .ico {
    flex: none;
    color: var(--muted);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta,
  .sub {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .head .ttl {
    margin: 0;
    font-size: var(--fs-lg);
  }
  .sub {
    margin: var(--pad-1) 0 var(--pad-3);
  }
  .body {
    margin: 0 0 var(--pad-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .thread {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
  }
  .msg {
    border-radius: var(--radius);
    padding: var(--pad-2) var(--pad-3);
    background: color-mix(in srgb, var(--muted) 8%, transparent);
  }
  .msg.admin {
    border-left: 3px solid var(--accent);
  }
  .msg p {
    margin: var(--pad-1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .from {
    font-size: var(--fs-xs);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }

  .reply textarea {
    width: 100%;
    min-width: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-3);
    margin-top: var(--pad-2);
    flex-wrap: wrap;
  }
  .statuses {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pad-1);
  }
  .dim {
    color: var(--muted);
  }
</style>
