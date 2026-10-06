<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { keep, recall } from "../shell/kept";
  import {
    JOB_NOTIFY,
    JOB_OVERLAP,
    jobQueue,
    type JobQueue,
  } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import {
    Button,
    Checkbox,
    CrudTable,
    Field,
    FilterBar,
    GroupHead,
    Icon,
    Modal,
    Note,
    Select,
    Tabs,
    isActive,
    tip,
    type Column,
    type Draft,
    Time,
  } from "../tui";
  import { describeSchedule } from "./cron";
  import { lastResult, statusMark } from "./status";
  import type {
    JobChange,
    JobDefinitionRow,
    JobKindInfo,
    JobRunRow,
    JsonSchema,
  } from "./rows";
  import SchedulePreview from "./SchedulePreview.svelte";
  import { sectionHoist } from "../admin/sectionAction.svelte";
  import { jobs as census } from "./census.svelte";

  type KindsInfo = {
    kinds: JobKindInfo[];
    chat_slot_cap: number;
    timezone: string;
    class_chat_slots: Record<string, number>;
    queues: JobQueue[];
  };
  type Connection = { slug: string; source_type: string; name?: string };

  const info = createResource(() => api.get<KindsInfo>("/jobs/kinds"), {
    kinds: [],
    chat_slot_cap: 0,
    timezone: "UTC",
    class_chat_slots: {},
    queues: [],
  } as KindsInfo);
  const defs = createResource(
    () => api.get<JobDefinitionRow[]>("/jobs/definitions"),
    [],
  );
  const connections = createResource(
    () => api.get<Connection[]>("/source-connections"),
    [],
  );

  let error = $state<string | null>(null);
  let filter = $state(recall("admin.jobs.filter", ""));
  $effect(() => keep("admin.jobs.filter", filter));
  let params = $state<Record<string, unknown>>({});
  let logOpen = $state(new Set<string>());
  let running = $state<string | null>(null);
  let pausing = $state<string | null>(null);
  /** The job whose runs and changes are open, and what was fetched for it. */
  let history = $state<JobDefinitionRow | null>(null);
  let historyRuns = $state<JobRunRow[] | null>(null);
  let historyChanges = $state<JobChange[]>([]);
  let historyTab = $state<"runs" | "changes">("runs");
  const HISTORY_LIMIT = 200;

  const kindOf = (k: unknown) => info.data.kinds.find((x) => x.kind === k);
  const opt = (values: readonly string[], inherit: string) => [
    { value: "", label: inherit },
    ...values.map((v) => ({ value: v, label: v })),
  ];

  /* No "failures only" toggle: each job's last run and its own run history
     already answer "what broke", and the overview's failed counter opens
     straight onto the jobs that did. */
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return defs.data.filter(
      (d) => !q || `${d.name} ${d.kind}`.toLowerCase().includes(q),
    );
  });

  const columns: Column<JobDefinitionRow>[] = $derived([
    { key: "health", label: "last run", width: "8rem", cell: healthCell },
    {
      key: "name",
      label: "job",
      width: "18rem",
      edit: "text",
      required: true,
      cell: nameCell,
      info: "Display name in run history and Teams.",
    },
    {
      key: "kind",
      label: "type",
      formOnly: true,
      only: "create",
      edit: "select",
      required: true,
      editable: () => false,
      options: info.data.kinds.map((k) => ({ value: k.kind, label: k.title })),
      info: "What the job does. Types are defined in code.",
    },
    {
      key: "schedule",
      label: "schedule",
      width: "14rem",
      edit: "text",
      placeholder: "0 2 * * *",
      value: (d) => d.schedule ?? "",
      cell: scheduleCell,
      info: "Cron, 5 fields. Blank: manual or event only.",
    },
    {
      key: "timezone",
      label: "timezone",
      formOnly: true,
      edit: "text",
      initial: info.data.timezone,
    },
    {
      key: "queue",
      label: "queue",
      width: "9rem",
      edit: "select",
      value: (d) => d.queue ?? "",
      options: (dr) => [
        {
          value: "",
          label: `type default (${kindOf(dr.kind)?.queue ?? "?"})`,
        },
        ...info.data.queues.map((q) => ({
          value: q.name,
          label: `${q.name} (${q.class}${q.cap ? `, ${q.cap} at a time` : ""})`,
        })),
      ],
      cell: queueCell,
      info: "The line its runs wait in. Each queue belongs to the light or heavy worker pool, whose sizes are set in Compose.",
    },
    {
      key: "timeout",
      label: "timeout",
      formOnly: true,
      edit: "text",
      value: (d) => d.timeout ?? "",
      placeholder: (dr) => kindOf(dr.kind)?.timeout ?? "1h",
      info: "Like 90s, 15m, 2h. Blank uses the type's.",
    },
    {
      key: "overlap",
      label: "overlap",
      formOnly: true,
      edit: "select",
      value: (d) => d.overlap ?? "",
      options: (dr) =>
        opt(JOB_OVERLAP, `type default (${kindOf(dr.kind)?.overlap ?? "?"})`),
      info: "Overlap policy: skip or queue.",
    },
    {
      key: "notify",
      label: "notify",
      formOnly: true,
      edit: "select",
      initial: "failure",
      options: JOB_NOTIFY.map((v) => ({ value: v, label: v })),
      info: "Posts to Teams (teams_job_webhook).",
    },
    {
      key: "enabled",
      label: "active",
      formOnly: true,
      edit: "checkbox",
      initial: true,
      info: "A paused job keeps its schedule but does not fire.",
    },
    /* The toggle is what people come to this list to use, so it sits on the
       row rather than one dialog away. */
    { key: "toggle", label: "active", width: "5rem", cell: toggleCell },
    { key: "acts", label: "", width: "3.5rem", align: "end", cell: actsCell },
  ]);

  function defaultsFor(schema: JsonSchema | undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(schema?.properties ?? {}))
      if (p.default !== undefined) out[k] = p.default;
    return out;
  }

  function openedForm(
    f: { mode: "create" | "edit"; row: JobDefinitionRow | null } | null,
  ) {
    params = f?.row ? { ...f.row.params } : {};
  }

  function payload(d: Draft) {
    const blank = (v: unknown) =>
      String(v ?? "").trim() ? String(v).trim() : null;
    return {
      name: String(d.name ?? "").trim(),
      schedule: blank(d.schedule),
      timezone: blank(d.timezone) ?? undefined,
      queue: blank(d.queue),
      timeout: blank(d.timeout),
      overlap: blank(d.overlap),
      notify: d.notify || "failure",
      enabled: Boolean(d.enabled),
      params,
    };
  }

  async function loadHistoryRuns(id: string) {
    const runs = await api.get<JobRunRow[]>(
      `/jobs/runs?definition_id=${id}&limit=${HISTORY_LIMIT}`,
    );
    if (history?.id === id) historyRuns = runs;
  }

  async function runNow(d: JobDefinitionRow) {
    running = d.id;
    error = null;
    try {
      await api.post(`/jobs/definitions/${d.id}/run`, {});
      await Promise.all([
        defs.reload(),
        history?.id === d.id ? loadHistoryRuns(d.id) : undefined,
      ]);
      void census.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      running = null;
    }
  }

  /* Pausing is disabling: there is no separate verb on the server, and a
     paused schedule is exactly a definition that is not enabled. */
  async function pause(d: JobDefinitionRow) {
    pausing = d.id;
    error = null;
    try {
      await api.patch(`/jobs/definitions/${d.id}`, { enabled: !d.enabled });
      await defs.reload();
      void census.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      pausing = null;
    }
  }

  async function openHistory(d: JobDefinitionRow) {
    history = d;
    historyRuns = null;
    historyChanges = [];
    historyTab = "runs";
    try {
      const [runs, changes] = await Promise.all([
        api.get<JobRunRow[]>(
          `/jobs/runs?definition_id=${d.id}&limit=${HISTORY_LIMIT}`,
        ),
        api.get<JobChange[]>(`/jobs/definitions/${d.id}/changes`),
      ]);
      if (history?.id !== d.id) return;
      historyRuns = runs;
      historyChanges = changes;
    } catch (e) {
      error = errText(e);
      history = null;
    }
  }

  async function cancel(run: JobRunRow) {
    error = null;
    try {
      await api.post(`/jobs/runs/${run.id}/cancel`, {});
      await Promise.all([
        defs.reload(),
        run.definition_id ? loadHistoryRuns(run.definition_id) : undefined,
      ]);
    } catch (e) {
      error = errText(e);
    }
  }

  function toggleLog(id: string) {
    const next = new Set(logOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    logOpen = next;
  }

  /* Runs move on the server; while any shown run is active, follow it. */
  const anyActive = $derived(
    defs.data.some((d) => isActive(d.last_run?.status)) ||
      (historyRuns ?? []).some((r) => isActive(r.status)),
  );
  let poll: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if (anyActive && !poll)
      poll = setInterval(() => {
        void defs.reload();
        if (history) void loadHistoryRuns(history.id).catch(() => {});
      }, 3000);
    if (!anyActive && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
  });

  onMount(() => {
    void info.reload();
    void defs.reload();
    void connections.reload();
  });

  async function createJob(d: Draft) {
    await defs.mutate(() =>
      api.post<JobDefinitionRow>("/jobs/definitions", {
        kind: d.kind,
        ...payload(d),
        params: { ...defaultsFor(kindOf(d.kind)?.params_schema), ...params },
      }),
    );
    void census.reload();
  }
</script>

{#snippet healthCell(d: JobDefinitionRow)}
  {#if d.disabled_reason}
    <span class="mark inline danger" use:tip={d.disabled_reason}
      ><Icon name="alert" size="1.1em" />invalid</span
    >
  {:else if d.last_run}
    {@const l = lastResult(d.last_run, Date.now())}
    <span
      class="mark inline {l.tone}"
      class:spin={d.last_run.status === "running"}
      ><Icon name={l.icon} size="1.1em" />
      <span class="dim">{l.short}</span></span
    >
  {:else}
    <span class="dim">never</span>
  {/if}
{/snippet}

{#snippet nameCell(d: JobDefinitionRow)}
  {@const title = kindOf(d.kind)?.title ?? d.kind}
  <span class="name">{d.name}</span>
  {#if d.name !== title || d.subject}
    <span class="dim small"
      >{d.name !== title ? title : ""}{d.name !== title && d.subject
        ? " · "
        : ""}{d.subject ?? ""}</span
    >
  {/if}
{/snippet}

{#snippet statusBadge(status: string)}
  {@const m = statusMark(status)}
  <span class="mark inline {m.tone}" class:spin={status === "running"}>
    <Icon name={m.icon} size="1.1em" />{m.label}
  </span>
{/snippet}

{#snippet scheduleCell(d: JobDefinitionRow)}
  {#if d.schedule}
    <span class="name" use:tip={d.schedule}
      >{describeSchedule(d.schedule)}{d.timezone === info.data.timezone
        ? ""
        : ` ${d.timezone}`}</span
    >
    {#if d.next_run}<span class="dim small">next <Time at={d.next_run} /></span
      >{/if}
  {:else}
    <span class="dim">manual only</span>
  {/if}
{/snippet}

{#snippet queueCell(d: JobDefinitionRow)}
  {@const queue = d.queue ?? kindOf(d.kind)?.queue}
  <span class="mono">{queue ?? "-"}</span>
{/snippet}

{#snippet runList(runs: JobRunRow[])}
  {#if !runs.length}
    <span class="dim">no runs yet</span>
  {:else}
    <table class="runs">
      <tbody>
        {#each runs as r (r.id)}
          <tr>
            <td>{@render statusBadge(r.status)}</td>
            <td class="dim">{r.trigger}</td>
            <td class="dim"><Time at={r.created_at} /></td>
            <td>
              {#if r.status === "running" && r.progress != null}
                {Math.round(r.progress * 100)}%{r.progress_note
                  ? ` · ${r.progress_note}`
                  : ""}
              {:else if r.error}
                <span class="err">{r.error}</span>
              {:else if r.attempts > 1}
                <span class="dim">attempt {r.attempts}/{r.max_attempts}</span>
              {/if}
            </td>
            <td class="acts">
              {#if r.log_tail}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => toggleLog(r.id)}
                  >{logOpen.has(r.id) ? "hide log" : "log"}</Button
                >
              {/if}
              {#if isActive(r.status)}
                <Button
                  variant="ghost"
                  size="sm"
                  tone="danger"
                  icon="stop"
                  onclick={() => cancel(r)}>stop</Button
                >
              {/if}
            </td>
          </tr>
          {#if logOpen.has(r.id)}
            <tr><td colspan="5"><pre class="log">{r.log_tail}</pre></td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{/snippet}

{#snippet paramField(
  name: string,
  p: JsonSchema,
  required: boolean,
  kind: JobKindInfo,
)}
  {#if name === "connection" && kind.connection}
    <Field
      label={name}
      {required}
      info={p.description ?? "The source connection this runs against."}
    >
      <Select
        value={String(params[name] ?? "")}
        options={[
          { value: "", label: "pick a connection…" },
          ...connections.data
            .filter(
              (c) =>
                kind.connection === "any" || c.source_type === kind.connection,
            )
            .map((c) => ({
              value: c.slug,
              label: `${c.slug} (${c.source_type})`,
            })),
        ]}
        aria-label={name}
        onchange={(v) => (params[name] = String(v))}
      />
    </Field>
  {:else if p.enum}
    <Field label={name} {required} info={p.description}>
      <Select
        value={String(params[name] ?? p.default ?? "")}
        options={p.enum.map((v) => ({ value: String(v), label: String(v) }))}
        aria-label={name}
        onchange={(v) => (params[name] = v)}
      />
    </Field>
  {:else if p.type === "boolean"}
    <Field label={name} info={p.description} inline>
      <Checkbox
        checked={Boolean(params[name] ?? p.default)}
        ariaLabel={name}
        onchange={(v) => (params[name] = v)}
      />
    </Field>
  {:else if p.type === "number" || p.type === "integer"}
    <Field label={name} {required} info={p.description}>
      <input
        inputmode="numeric"
        value={params[name] ?? p.default ?? ""}
        placeholder={p.default !== undefined ? String(p.default) : ""}
        oninput={(e) => {
          const t = e.currentTarget.value.trim();
          if (t === "") delete params[name];
          else params[name] = Number(t);
        }}
      />
    </Field>
  {:else}
    <Field label={name} {required} info={p.description}>
      <input
        value={String(params[name] ?? "")}
        placeholder={p.default !== undefined ? String(p.default) : ""}
        oninput={(e) => (params[name] = e.currentTarget.value)}
      />
    </Field>
  {/if}
{/snippet}

{#snippet formExtra(f: {
  mode: "create" | "edit";
  row: JobDefinitionRow | null;
  draft: Draft;
})}
  {@const kind = kindOf(f.draft.kind)}
  {@const effectiveClass = jobQueue(
    String(f.draft.queue || kind?.queue || "maintenance"),
  ).class}
  {#if kind}
    {#if f.mode === "edit" || kind.description}
      <Note
        >{#if f.mode === "edit"}<strong>{kind.title}.</strong>
        {/if}{kind.description ?? ""}</Note
      >
    {/if}
    {#if Object.keys(kind.params_schema.properties ?? {}).length}
      <GroupHead label="parameters" />
      {#each Object.entries(kind.params_schema.properties ?? {}) as [name, p] (name)}
        {@render paramField(
          name,
          p,
          (kind.params_schema.required ?? []).includes(name),
          kind,
        )}
      {/each}
    {/if}
    <SchedulePreview schedule={f.draft.schedule} timezone={f.draft.timezone} />
    {#if (info.data.class_chat_slots[effectiveClass] ?? 0) > 0}
      <Note>
        while this runs, the chat cap is
        {Math.max(
          1,
          info.data.chat_slot_cap - info.data.class_chat_slots[effectiveClass],
        )}
        instead of {info.data.chat_slot_cap}.
      </Note>
    {/if}
  {/if}
  {#if f.row?.disabled_reason}<Note tone="danger">{f.row.disabled_reason}</Note
    >{/if}
{/snippet}

<!-- Pausing happens on the row, as one button that is the job's state: a
     check while it is active, a pause while it is not, one morphing into the
     other. Not marked busy, which would swap the icon out mid-tween. Running
     now lives in the dialog, where the job's settings and history are. -->
{#snippet toggle(d: JobDefinitionRow)}
  <Button
    variant="ghost"
    square
    iconSize="1.4em"
    icon={d.enabled ? "active" : "pause"}
    morph
    tone={d.enabled ? "ok" : "warn"}
    aria-pressed={!d.enabled}
    title={d.enabled ? "active, click to pause" : "paused, click to resume"}
    aria-label={d.enabled ? `pause ${d.name}` : `resume ${d.name}`}
    disabled={pausing === d.id}
    onclick={() => pause(d)}
  />
{/snippet}

{#snippet dialogActions(d: JobDefinitionRow)}
  <Button
    variant="ghost"
    square
    iconSize="1.4em"
    icon="run"
    tone="ok"
    title="run now"
    aria-label={`run ${d.name} now`}
    busy={running === d.id}
    disabled={running === d.id}
    onclick={() => runNow(d)}
  />
  {@render historyButton(d)}
{/snippet}

{#snippet historyButton(d: JobDefinitionRow)}
  <Button
    variant="ghost"
    square
    iconSize="1.4em"
    icon="history"
    title="runs and changes"
    aria-label={`runs and changes of ${d.name}`}
    onclick={() => openHistory(d)}
  />
{/snippet}

{#snippet toggleCell(d: JobDefinitionRow)}
  {@render toggle(d)}
{/snippet}

{#snippet actsCell(d: JobDefinitionRow)}
  <span class="acts">{@render historyButton(d)}</span>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{#if info.error}<Note tone="danger">{info.error}</Note>{/if}

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={defs.data.length}
  label="search jobs"
/>

<CrudTable
  hoist={sectionHoist("jobs")}
  {columns}
  rows={filtered}
  rowKey={(d) => d.id}
  loading={defs.loading || info.loading}
  error={defs.error}
  emptyTitle={defs.data.length ? "No jobs match." : "No job definitions yet."}
  addLabel="add job"
  noun="job"
  editTitle={(d) => d.name}
  width="48rem"
  extraActions={dialogActions}
  {formExtra}
  onform={(f) => {
    openedForm(f);
    if (f?.mode === "create") params = {};
  }}
  oncreate={createJob}
  onsave={(row, d) =>
    defs.mutate(() => api.patch(`/jobs/definitions/${row.id}`, payload(d)))}
  ondelete={(row) =>
    defs.mutate(async () => {
      await api.delete(`/jobs/definitions/${row.id}`);
      void census.reload();
    })}
/>

{#if history}
  {@const h = history}
  <Modal
    title={h.name}
    width="56rem"
    cancelLabel="close"
    onCancel={() => {
      history = null;
      historyRuns = null;
    }}
  >
    <Tabs
      items={[
        { key: "runs", label: "RUNS" },
        { key: "changes", label: "CHANGES" },
      ]}
      active={historyTab}
      anchor="--job-history-tab"
      onpick={(k) => (historyTab = k as "runs" | "changes")}
    />
    {#if !historyRuns}
      <p class="dim">loading…</p>
    {:else if historyTab === "runs"}
      {#if historyRuns.length === HISTORY_LIMIT}
        <p class="dim small">the newest {HISTORY_LIMIT}</p>
      {/if}
      {@render runList(historyRuns)}
    {:else}
      {#each historyChanges as c (c.id)}
        <div class="dim small">
          <Time at={c.created_at} /> · {c.action} by {c.changed_by ??
            "the system"}
        </div>
      {:else}
        <span class="dim">none recorded</span>
      {/each}
    {/if}
  </Modal>
{/if}

<style>
  .acts {
    display: inline-flex;
    gap: var(--pad-1);
  }
  .dim {
    color: var(--muted);
  }
  .small {
    display: block;
    font-size: 0.85em;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .by {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .by span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark {
    display: inline-flex;
    color: var(--muted);
  }
  .mark.inline {
    align-items: center;
    gap: var(--pad-1);
  }
  .mark.ok {
    color: var(--ok);
  }
  .mark.danger {
    color: var(--danger);
  }
  .mark.accent {
    color: var(--accent);
  }
  .mark.spin :global(svg) {
    animation: spin 1.4s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mark.spin :global(svg) {
      animation: none;
    }
  }
  .runs {
    width: 100%;
    border-collapse: collapse;
  }
  .runs td {
    padding: 2px var(--pad-2);
    vertical-align: top;
  }
  .runs .acts {
    text-align: end;
    white-space: nowrap;
  }
  .err {
    color: var(--danger);
  }
  .log {
    max-height: 16rem;
    overflow: auto;
    margin: 0;
    padding: var(--pad-2);
    border: 1px dashed var(--border);
    white-space: pre-wrap;
    font-size: 0.85em;
  }
</style>
