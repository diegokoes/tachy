<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { keep, recall } from "../kept";
  import { JOB_NOTIFY, JOB_OVERLAP, JOB_RESOURCE_CLASSES } from "@tachy/contract";
  import { api } from "../api";
  import { createResource, errText } from "../resource.svelte";
  import {
    Badge,
    Button,
    Checkbox,
    CrudTable,
    Field,
    FilterBar,
    GroupHead,
    Modal,
    Note,
    Select,
    isActive,
    toneOf,
    type Column,
    type Draft,
  } from "../tui";
  import { fmtDateTime } from "../dates";
  import type {
    JobChange,
    JobDefinitionRow,
    JobKindInfo,
    JobRunRow,
    JsonSchema,
  } from "./rows";
  import SchedulePreview from "./SchedulePreview.svelte";
  import { sectionHoist } from "./sectionAction.svelte";
  import { jobs as census } from "./jobCensus.svelte";

  type KindsInfo = {
    kinds: JobKindInfo[];
    chat_slot_cap: number;
    class_chat_slots: Record<string, number>;
  };
  type Connection = { slug: string; source_type: string; name?: string };

  const info = createResource(
    () => api.get<KindsInfo>("/jobs/kinds"),
    { kinds: [], chat_slot_cap: 0, class_chat_slots: {} } as KindsInfo,
  );
  const defs = createResource(() => api.get<JobDefinitionRow[]>("/jobs/definitions"), []);
  const recent = createResource(() => api.get<JobRunRow[]>("/jobs/runs?limit=20"), []);
  const connections = createResource(
    () => api.get<Connection[]>("/source-connections"),
    [],
  );

  let error = $state<string | null>(null);
  let filter = $state(recall("admin.jobs.filter", ""));
  $effect(() => keep("admin.jobs.filter", filter));
  let params = $state<Record<string, unknown>>({});
  let runsFor = $state<Record<string, JobRunRow[]>>({});
  let changesFor = $state<Record<string, JobChange[]>>({});
  let logOpen = $state(new Set<string>());
  let running = $state<string | null>(null);
  let pausing = $state<string | null>(null);
  /** The job whose record dialog is open, if one is. */
  let opened = $state<JobDefinitionRow | null>(null);
  /** The job whose full run history is open, and what was fetched for it. */
  let history = $state<JobDefinitionRow | null>(null);
  let historyRuns = $state<JobRunRow[] | null>(null);

  const kindOf = (k: unknown) => info.data.kinds.find((x) => x.kind === k);
  const opt = (values: readonly string[], inherit: string) => [
    { value: "", label: inherit },
    ...values.map((v) => ({ value: v, label: v })),
  ];

  /* No "failures only" toggle: the recent-runs list below and each job's own
     history already answer "what broke", and the overview's failed counter
     opens straight onto the jobs that did. */
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return defs.data.filter(
      (d) => !q || `${d.name} ${d.kind}`.toLowerCase().includes(q),
    );
  });

  const columns: Column<JobDefinitionRow>[] = $derived([
    {
      key: "name",
      label: "name",
      width: "14rem",
      edit: "text",
      required: true,
      info: "Display name in run history and Teams.",
    },
    {
      key: "kind",
      label: "kind",
      width: "11rem",
      edit: "select",
      required: true,
      editable: () => false,
      options: info.data.kinds.map((k) => ({ value: k.kind, label: `${k.kind}: ${k.title}` })),
      info: "Job kind. Defined in code.",
    },
    {
      key: "schedule",
      label: "schedule",
      width: "10rem",
      edit: "text",
      placeholder: "0 2 * * *",
      value: (d) => d.schedule ?? "",
      cell: scheduleCell,
      info: "Cron, 5 fields. Blank: manual or event only.",
    },
    { key: "timezone", label: "timezone", formOnly: true, edit: "text", initial: "UTC" },
    {
      key: "resource_class",
      label: "class",
      width: "6rem",
      edit: "select",
      value: (d) => d.resource_class ?? "",
      options: (dr) => opt(JOB_RESOURCE_CLASSES, `kind default (${kindOf(dr.kind)?.resource_class ?? "?"})`),
      cell: classCell,
      info: "Worker pool. Sizes set in Compose.",
    },
    {
      key: "timeout",
      label: "timeout",
      formOnly: true,
      edit: "text",
      value: (d) => d.timeout ?? "",
      placeholder: (dr) => kindOf(dr.kind)?.timeout ?? "1h",
      info: "Like 90s, 15m, 2h. Blank uses the kind's.",
    },
    {
      key: "overlap",
      label: "overlap",
      formOnly: true,
      edit: "select",
      value: (d) => d.overlap ?? "",
      options: (dr) => opt(JOB_OVERLAP, `kind default (${kindOf(dr.kind)?.overlap ?? "?"})`),
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
    { key: "enabled", label: "on", width: "4rem", edit: "checkbox", initial: true, cell: enabledCell },
    { key: "last", label: "last run", width: "11rem", cell: lastCell },
    /* Running and pausing are what people come to this list to do, so they
       sit on the row rather than one dialog away. */
    { key: "acts", label: "", width: "8rem", align: "end", cell: actsCell },
  ]);

  function defaultsFor(schema: JsonSchema | undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(schema?.properties ?? {}))
      if (p.default !== undefined) out[k] = p.default;
    return out;
  }

  function openedForm(f: { mode: "create" | "edit"; row: JobDefinitionRow | null } | null) {
    params = f?.row ? { ...f.row.params } : {};
  }

  function payload(d: Draft) {
    const blank = (v: unknown) => (String(v ?? "").trim() ? String(v).trim() : null);
    return {
      name: String(d.name ?? "").trim(),
      schedule: blank(d.schedule),
      timezone: blank(d.timezone) ?? "UTC",
      resource_class: blank(d.resource_class),
      timeout: blank(d.timeout),
      overlap: blank(d.overlap),
      notify: d.notify || "failure",
      enabled: Boolean(d.enabled),
      params,
    };
  }

  async function loadDetail(id: string) {
    const [runs, changes] = await Promise.all([
      api.get<JobRunRow[]>(`/jobs/runs?definition_id=${id}&limit=20`),
      api.get<JobChange[]>(`/jobs/definitions/${id}/changes`),
    ]);
    runsFor[id] = runs;
    changesFor[id] = changes;
  }

  async function runNow(d: JobDefinitionRow) {
    running = d.id;
    error = null;
    try {
      await api.post(`/jobs/definitions/${d.id}/run`, {});
      await loadDetail(d.id);
      await Promise.all([defs.reload(), recent.reload()]);
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
    try {
      historyRuns = await api.get<JobRunRow[]>(
        `/jobs/runs?definition_id=${d.id}&limit=200`,
      );
    } catch (e) {
      error = errText(e);
      history = null;
    }
  }

  async function cancel(run: JobRunRow) {
    error = null;
    try {
      await api.post(`/jobs/runs/${run.id}/cancel`, {});
      if (run.definition_id) await loadDetail(run.definition_id);
      await recent.reload();
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
    recent.data.some((r) => isActive(r.status)) ||
      Object.values(runsFor).some((rs) => rs.some((r) => isActive(r.status))),
  );
  let poll: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if (anyActive && !poll)
      poll = setInterval(() => {
        void recent.reload();
        void defs.reload();
        if (opened) void loadDetail(opened.id).catch(() => {});
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
    void recent.reload();
    void connections.reload();
  });

  /* What hangs off a job (its recent runs and its change log) is fetched when
     its dialog opens. */
  $effect(() => {
    const id = opened?.id;
    if (!id) return;
    untrack(() => void loadDetail(id).catch((e) => (error = errText(e))));
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

{#snippet scheduleCell(d: JobDefinitionRow)}
  {#if d.schedule}
    <span class="sched">{d.schedule}<span class="dim">{d.timezone === "UTC" ? "" : ` ${d.timezone}`}</span></span>
    {#if d.next_run}<span class="dim small">next {fmtDateTime(d.next_run)}</span>{/if}
  {:else}
    <span class="dim">by hand</span>
  {/if}
{/snippet}

{#snippet classCell(d: JobDefinitionRow)}
  {d.resource_class ?? kindOf(d.kind)?.resource_class ?? "-"}
{/snippet}

{#snippet enabledCell(d: JobDefinitionRow)}
  {#if d.disabled_reason}
    <Badge tone="danger">disabled</Badge>
  {:else}
    <Badge tone={d.enabled ? "ok" : "muted"}>{d.enabled ? "on" : "off"}</Badge>
  {/if}
{/snippet}

{#snippet lastCell(d: JobDefinitionRow)}
  {#if d.last_run}
    <Badge tone={toneOf(d.last_run.status)}>{d.last_run.status}</Badge>
    <span class="dim small">{fmtDateTime(d.last_run.created_at)}</span>
  {:else}
    <span class="dim">never</span>
  {/if}
{/snippet}

{#snippet runList(runs: JobRunRow[], showKind: boolean)}
  {#if !runs.length}
    <span class="dim">no runs yet</span>
  {:else}
    <table class="runs">
      <tbody>
        {#each runs as r (r.id)}
          <tr>
            <td><Badge tone={toneOf(r.status)}>{r.status}</Badge></td>
            {#if showKind}<td>{r.kind}</td>{/if}
            <td class="dim">{r.trigger}</td>
            <td class="dim">{fmtDateTime(r.created_at)}</td>
            <td>
              {#if r.status === "running" && r.progress != null}
                {Math.round(r.progress * 100)}%{r.progress_note ? ` · ${r.progress_note}` : ""}
              {:else if r.error}
                <span class="err">{r.error}</span>
              {:else if r.attempts > 1}
                <span class="dim">attempt {r.attempts}/{r.max_attempts}</span>
              {/if}
            </td>
            <td class="acts">
              {#if r.log_tail}
                <Button variant="ghost" size="sm" onclick={() => toggleLog(r.id)}
                  >{logOpen.has(r.id) ? "hide log" : "log"}</Button
                >
              {/if}
              {#if isActive(r.status)}
                <Button
                  variant="ghost"
                  size="sm"
                  tone="danger"
                  icon="stop"
                  title="stop this run; it finishes its current step first"
                  onclick={() => cancel(r)}>stop</Button
                >
              {/if}
            </td>
          </tr>
          {#if logOpen.has(r.id)}
            <tr><td colspan={showKind ? 6 : 5}><pre class="log">{r.log_tail}</pre></td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
{/snippet}

{#snippet detail(d: JobDefinitionRow)}
  <div class="detail">
    {#if d.disabled_reason}<Note tone="danger">{d.disabled_reason}</Note>{/if}
    <GroupHead label="runs" />
    {@render runList(runsFor[d.id] ?? [], false)}
    <GroupHead label="changes" />
    {#each changesFor[d.id] ?? [] as c (c.id)}
      <div class="dim small">{fmtDateTime(c.created_at)} · {c.action} by {c.changed_by ?? "the system"}</div>
    {:else}
      <span class="dim">none recorded</span>
    {/each}
  </div>
{/snippet}

{#snippet paramField(name: string, p: JsonSchema, required: boolean, kind: JobKindInfo)}
  {#if name === "connection" && kind.connection}
    <Field label={name} {required} info={p.description ?? "The source connection this runs against."}>
      <Select
        value={String(params[name] ?? "")}
        options={[
          { value: "", label: "pick a connection…" },
          ...connections.data
            .filter((c) => kind.connection === "any" || c.source_type === kind.connection)
            .map((c) => ({ value: c.slug, label: `${c.slug} (${c.source_type})` })),
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

{#snippet formExtra(f: { mode: "create" | "edit"; row: JobDefinitionRow | null; draft: Draft })}
  {@const kind = kindOf(f.draft.kind)}
  {@const effectiveClass = String(f.draft.resource_class || kind?.resource_class || "light")}
  {#if kind}
    {#if kind.description}<Note>{kind.description}</Note>{/if}
    {#if Object.keys(kind.params_schema.properties ?? {}).length}
      <GroupHead label="parameters" />
      {#each Object.entries(kind.params_schema.properties ?? {}) as [name, p] (name)}
        {@render paramField(name, p, (kind.params_schema.required ?? []).includes(name), kind)}
      {/each}
    {/if}
    <SchedulePreview schedule={f.draft.schedule} timezone={f.draft.timezone} />
    {#if (info.data.class_chat_slots[effectiveClass] ?? 0) > 0}
      <Note>
        while this runs, the chat cap is
        {Math.max(1, info.data.chat_slot_cap - info.data.class_chat_slots[effectiveClass])}
        instead of {info.data.chat_slot_cap}.
      </Note>
    {/if}
  {/if}
  {#if f.row}{@render detail(f.row)}{/if}
{/snippet}

<!-- The controls a job is opened for, on the row and in its dialog alike.
     Pause stays lit while a job is paused, so the state is on the button
     that changes it. -->
{#snippet controls(d: JobDefinitionRow)}
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
  <Button
    variant="ghost"
    square
    iconSize="1.4em"
    icon="pause"
    tone={d.enabled ? undefined : "warn"}
    aria-pressed={!d.enabled}
    title={d.enabled
      ? d.schedule
        ? "pause the schedule"
        : "pause"
      : "paused, click to resume"}
    aria-label={d.enabled ? `pause ${d.name}` : `resume ${d.name}`}
    busy={pausing === d.id}
    disabled={pausing === d.id}
    onclick={() => pause(d)}
  />
  <Button
    variant="ghost"
    square
    iconSize="1.4em"
    icon="history"
    title="every run of this job"
    aria-label={`history of ${d.name}`}
    onclick={() => openHistory(d)}
  />
{/snippet}

{#snippet actsCell(d: JobDefinitionRow)}
  <span class="acts">{@render controls(d)}</span>
{/snippet}

{#if error}<Note tone="danger">{error}</Note>{/if}
{#if info.error}<Note tone="danger">{info.error}</Note>{/if}

<FilterBar
  bind:value={filter}
  shown={filtered.length}
  total={defs.data.length}
  placeholder="filter jobs…"
  label="filter jobs"
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
  extraActions={controls}
  {formExtra}
  onform={(f) => {
    openedForm(f);
    opened = f?.row ?? null;
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

<GroupHead label="recent runs, every job" />
{@render runList(recent.data, true)}

{#if history}
  {@const h = history}
  <Modal
    title={`${h.name}: every run`}
    width="56rem"
    cancelLabel="close"
    onCancel={() => {
      history = null;
      historyRuns = null;
    }}
  >
    {#if !historyRuns}
      <p class="dim">loading…</p>
    {:else}
      <p class="dim small">
        {historyRuns.length}
        {historyRuns.length === 1 ? "run" : "runs"}{historyRuns.length === 200
          ? ", the newest 200"
          : ""}. Kept 90 days, failures 180.
      </p>
      {@render runList(historyRuns, false)}
    {/if}
  </Modal>
{/if}

<style>
  .acts { display: inline-flex; gap: var(--pad-1); }
  .dim { color: var(--muted); }
  .small { display: block; font-size: 0.85em; }
  .sched { font-family: var(--font-mono); }
  .runs { width: 100%; border-collapse: collapse; }
  .runs td { padding: 2px var(--pad-2); vertical-align: top; }
  .runs .acts { text-align: end; white-space: nowrap; }
  .err { color: var(--danger); }
  .log { max-height: 16rem; overflow: auto; margin: 0; padding: var(--pad-2); border: 1px dashed var(--border); white-space: pre-wrap; font-size: 0.85em; }
  .detail { padding: var(--pad-2) 0; }
</style>
