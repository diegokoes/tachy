<script lang="ts">
  import type {
    Condition,
    FlowActionInfo,
    FlowGraph,
    FlowOption,
    FlowStep,
    FlowStepTrace,
    FlowTrigger,
  } from "@tachy/contract";
  import { Button, Checkbox, Field, Note, Select } from "../tui";
  import ConditionEditor from "./ConditionEditor.svelte";
  import {
    findStep,
    newCondition,
    removeStep,
    replaceStep,
    replaceTrigger,
    stepsBefore,
    TRIGGER_TITLES,
    type Selection,
  } from "./graph";
  import OptionSelect from "./OptionSelect.svelte";
  import { fetchOptions } from "./options.svelte";
  import SchemaForm from "./SchemaForm.svelte";
  import type { Schema } from "./schema";

  let {
    graph,
    selection,
    actions,
    connection,
    trace = null,
    onchange,
    onselect,
  }: {
    graph: FlowGraph;
    selection: Selection;
    actions: Map<string, FlowActionInfo>;
    /** The connection the flow's items come from, for field and value lists. */
    connection: string;
    /** What the selected step did in the run being looked at. */
    trace?: FlowStepTrace | null;
    onchange: (g: FlowGraph) => void;
    onselect: (s: Selection | null) => void;
  } = $props();

  const trigger = $derived(
    selection.kind === "trigger"
      ? (graph.triggers.find((t) => t.id === selection.id) ?? null)
      : null,
  );
  const step = $derived(
    selection.kind === "step" ? findStep(graph.steps, selection.id) : null,
  );
  const action = $derived(
    step?.kind === "action" ? (actions.get(step.action) ?? null) : null,
  );

  let itemFields = $state<FlowOption[]>([]);
  $effect(() => {
    fetchOptions("item.fields", connection ? { connection } : {})
      .then((f) => (itemFields = f))
      .catch(() => (itemFields = []));
  });

  /** `item.*` and what each earlier step returns, for `{{…}}`. */
  const variables = $derived.by<FlowOption[]>(() => {
    if (!step) return [];
    const upstream = stepsBefore(graph.steps, step.id).flatMap((s) => {
      if (s.kind !== "action") return [];
      const out = actions.get(s.action)?.output_schema as Schema | undefined;
      return Object.keys(out?.properties ?? {}).map((k) => ({
        value: `steps.${s.id}.${k}`,
        label: `${s.id}.${k}`,
        hint: actions.get(s.action)?.title,
      }));
    });
    return [...upstream.reverse(), ...itemFields];
  });

  const setStep = (s: FlowStep) => onchange(replaceStep(graph, s));
  const setTrigger = (t: FlowTrigger) => onchange(replaceTrigger(graph, t));

  function removeSelected() {
    if (selection.kind === "step") onchange(removeStep(graph, selection.id));
    else
      onchange({
        ...graph,
        triggers: graph.triggers.filter((t) => t.id !== selection.id),
      });
    onselect(null);
  }

  const KINDS = (Object.keys(TRIGGER_TITLES) as FlowTrigger["kind"][]).map(
    (k) => ({ value: k, label: TRIGGER_TITLES[k] }),
  );
  const str = (v: unknown) => (v == null ? "" : String(v));
  const events = (t: FlowTrigger): string[] =>
    Array.isArray(t.params.events) && t.params.events.length
      ? (t.params.events as string[])
      : ["created", "updated"];
  function toggleEvent(t: FlowTrigger, e: string, on: boolean) {
    const now = new Set(events(t));
    if (on) now.add(e);
    else now.delete(e);
    if (!now.size) return;
    setTrigger({ ...t, params: { ...t.params, events: [...now] } });
  }
  const setParam = (t: FlowTrigger, k: string, v: unknown) =>
    setTrigger({
      ...t,
      params: Object.fromEntries(
        Object.entries({ ...t.params, [k]: v }).filter(
          ([, x]) => x !== "" && x !== undefined,
        ),
      ),
    });
  const setWhere = (t: FlowTrigger, where: Condition | undefined) => {
    const next = { ...t };
    if (where) next.where = where;
    else delete next.where;
    setTrigger(next);
  };
  const triggerConnection = (t: FlowTrigger) =>
    str(t.params.connection) || connection;

  const show = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
</script>

<div class="inspector">
  {#if trigger}
    {@const t = trigger}
    <header>
      <span class="what">trigger</span>
      <span class="id">{t.id}</span>
    </header>
    <Field label="starts the flow">
      <Select
        value={t.kind}
        options={KINDS}
        aria-label="Trigger kind"
        onchange={(k) =>
          setTrigger({
            id: t.id,
            kind: k as FlowTrigger["kind"],
            params:
              k === "schedule"
                ? { cron: "0 7 * * 1-5", timezone: "UTC" }
                : k === "item.synced"
                  ? { connection }
                  : {},
          })}
      />
    </Field>
    {#if t.kind === "item.synced" || t.kind === "schedule"}
      <Field
        label="connection"
        required={t.kind === "item.synced"}
        info={t.kind === "schedule"
          ? "With one, the flow runs once per recent item of it that passes the condition; without, once on its own."
          : undefined}
      >
        <OptionSelect
          source="connections"
          value={str(t.params.connection)}
          label="Connection"
          onchange={(v) => setParam(t, "connection", v)}
        />
      </Field>
    {/if}
    {#if t.kind === "item.synced"}
      <Field label="on" plain>
        <span class="events">
          {#each ["created", "updated"] as e (e)}
            <span class="event">
              <Checkbox
                checked={events(t).includes(e)}
                ariaLabel={e}
                onchange={(on) => toggleEvent(t, e, on)}
              />
              {e}
            </span>
          {/each}
        </span>
      </Field>
    {:else if t.kind === "schedule"}
      <Field label="cron" required info="minute hour day month weekday">
        <input
          value={str(t.params.cron)}
          oninput={(e) => setParam(t, "cron", e.currentTarget.value)}
        />
      </Field>
      <Field label="timezone">
        <input
          value={str(t.params.timezone ?? "UTC")}
          oninput={(e) => setParam(t, "timezone", e.currentTarget.value)}
        />
      </Field>
      {#if t.params.connection}
        <Field label="items changed in the last … days">
          <input
            inputmode="numeric"
            value={str(t.params.since_days ?? 7)}
            oninput={(e) =>
              setParam(
                t,
                "since_days",
                Number(e.currentTarget.value) || undefined,
              )}
          />
        </Field>
        <Field label="at most … items per run">
          <input
            inputmode="numeric"
            value={str(t.params.max_items ?? 50)}
            oninput={(e) =>
              setParam(
                t,
                "max_items",
                Number(e.currentTarget.value) || undefined,
              )}
          />
        </Field>
      {/if}
    {/if}
    {#if t.kind !== "manual"}
      <Field label="only for items where" plain>
        {#if t.where}
          <ConditionEditor
            value={t.where}
            connection={triggerConnection(t)}
            onchange={(c) => setWhere(t, c)}
            onremove={() => setWhere(t, undefined)}
          />
        {:else}
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onclick={() => setWhere(t, { all: [newCondition()] })}
            >add a condition</Button
          >
        {/if}
      </Field>
    {/if}
  {:else if step}
    {@const s = step}
    <header>
      <span class="what"
        >{s.kind === "action"
          ? (action?.title ?? s.action)
          : s.kind === "if"
            ? "if"
            : "only if"}</span
      >
      <span class="id" title="later steps read this one as steps.{s.id}"
        >{s.id}</span
      >
    </header>
    {#if action?.description}<Note>{action.description}</Note>{/if}
    {#if s.kind === "action" && !action}
      <Note tone="danger">'{s.action}' is not in the library any more.</Note>
    {/if}
    <Field label="label">
      <input
        value={s.label ?? ""}
        placeholder="what the canvas calls it"
        oninput={(e) =>
          setStep({ ...s, label: e.currentTarget.value || undefined })}
      />
    </Field>
    {#if s.kind === "action" && action}
      <SchemaForm
        schema={action.params_schema as Schema}
        value={s.params}
        {variables}
        onchange={(params) => setStep({ ...s, params })}
      />
    {:else if s.kind === "if" || s.kind === "filter"}
      <Field
        label={s.kind === "if" ? "take then when" : "go on only when"}
        plain
      >
        <ConditionEditor
          value={"all" in s.when || "any" in s.when
            ? s.when
            : { all: [s.when] }}
          {connection}
          onchange={(when) => setStep({ ...s, when })}
        />
      </Field>
      {#if s.kind === "if"}
        <Note
          >then and else each end the flow; steps after an if go in its
          branches.</Note
        >
      {/if}
    {/if}
    {#if trace}
      <section class="trace">
        <span class="what"
          >in this run: {trace.status}{trace.held !== undefined
            ? trace.held
              ? ", held"
              : ", did not hold"
            : ""} · {trace.ms} ms</span
        >
        {#if trace.error}<Note tone="danger">{trace.error}</Note>{/if}
        {#if trace.input !== undefined}
          <details>
            <summary>input</summary>
            <pre>{show(trace.input)}</pre>
          </details>
        {/if}
        {#if trace.output !== undefined}
          <details open>
            <summary>output</summary>
            <pre>{show(trace.output)}</pre>
          </details>
        {/if}
      </section>
    {/if}
  {/if}
  <footer>
    <Button variant="danger" size="sm" icon="delete" onclick={removeSelected}
      >remove{selection.kind === "step" && step?.kind === "if"
        ? " with its branches"
        : ""}</Button
    >
  </footer>
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--pad-2);
    padding-bottom: var(--pad-2);
    border-bottom: 1px solid var(--border);
  }
  .what {
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .id {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  input {
    width: 100%;
  }
  /* A panel this narrow gives every control its whole width. */
  .inspector :global(.field:not(.inline) .control > *) {
    flex: 1;
    min-width: 0;
  }
  .events {
    display: flex;
    gap: var(--pad-4);
  }
  .event {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    font-size: var(--fs-sm);
  }
  .trace {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    padding-top: var(--pad-2);
    border-top: 1px dashed var(--border);
  }
  pre {
    max-height: 16rem;
    overflow: auto;
    margin: var(--pad-1) 0 0;
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    word-break: break-word;
  }
  summary {
    font-size: var(--fs-xs);
    color: var(--muted);
    cursor: pointer;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--pad-2);
  }
</style>
