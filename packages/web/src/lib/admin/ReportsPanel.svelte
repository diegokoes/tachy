<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { refreshNotifications, toast } from "../notify.svelte";
  import { Badge, Button, Note, Icon, EmptyState } from "../tui";
  import { age } from "./overview";
  import { census } from "./census.svelte";
  import {
    REPORT_STATUSES,
    type ReportRow,
    type ReportStatus,
    type ReportType,
  } from "@tachy/contract";

  let list = $state<ReportRow[]>([]);
  let selected = $state<ReportRow | null>(null);
  let filter = $state<ReportStatus | "all">("open");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let reply = $state("");
  let busy = $state(false);

  const STATUS_TONE: Record<ReportStatus, "warn" | "accent" | "ok" | "muted"> = {
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
      const q = filter === "all" ? "" : `?status=${filter}`;
      list = await api.get<ReportRow[]>(`/reports/all${q}`);
      if (selected && !list.some((r) => r.id === selected!.id)) selected = null;
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
      toast("reply sent — the reporter will be notified", "ok");
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
      {#each ["open", "in_progress", "resolved", "closed", "all"] as f}
        <button
          class="filter"
          class:on={filter === f}
          onclick={() => (filter = f as ReportStatus | "all")}
        >
          {f.replace("_", " ")}
        </button>
      {/each}
    </div>

    {#if error && !selected}<Note tone="danger">{error}</Note>{/if}

    {#if loading}
      <p class="dim">loading…</p>
    {:else if list.length === 0}
      <EmptyState icon="flag" title="nothing here" />
    {:else}
      <ul class="rows">
        {#each list as r (r.id)}
          <li>
            <button
              class="row"
              class:on={selected?.id === r.id}
              onclick={() => open(r.id)}
            >
              <span class="ico"><Icon name={r.type === "bug" ? "bug" : "lightbulb"} size="1em" weight={7} /></span>
              <span class="who">
                <span class="ttl">{r.title || r.body_text.slice(0, 60)}</span>
                <span class="meta">
                  {r.reporter_name ?? "someone"} · {age(r.created_at)} ago
                </span>
              </span>
              <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
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
      {@const s = selected}
      <div class="head">
        <Badge tone={typeTone(s.type)}>{s.type}</Badge>
        <h3 class="ttl">{s.title || "untitled report"}</h3>
      </div>
      <p class="sub">
        from {s.reporter_name ?? "someone"} · {age(s.created_at)} ago
      </p>

      <p class="body">{s.body_text}</p>

      {#if s.ai_review && s.ai_review.suggestions.length}
        <Note tone="muted">
          AI review flagged: {s.ai_review.suggestions.join("; ")}
        </Note>
      {/if}

      {#if s.messages && s.messages.length}
        <div class="thread">
          {#each s.messages as m (m.id)}
            <div class="msg {m.direction}">
              <span class="from">{m.direction === "admin" ? (m.author_name ?? "admin") : (s.reporter_name ?? "reporter")}</span>
              <p>{m.body_text}</p>
            </div>
          {/each}
        </div>
      {/if}

      {#if error}<Note tone="danger">{error}</Note>{/if}

      <div class="reply">
        <textarea rows="3" placeholder="reply to the reporter…" bind:value={reply}></textarea>
        <div class="actions">
          <div class="statuses">
            {#each REPORT_STATUSES as st}
              <button
                class="status"
                class:on={s.status === st}
                disabled={busy}
                onclick={() => setStatus(st)}
              >
                {st.replace("_", " ")}
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
