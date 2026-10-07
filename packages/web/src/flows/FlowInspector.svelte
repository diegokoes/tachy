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
  import Group from "../settings/Group.svelte";
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
    onchange: (graph: FlowGraph) => void;
    onselect: (selection: Selection | null) => void;
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

  /**
   * What each earlier step returns. A record whose keys are a param's picks
   * (`x-keys-from`) is offered key by key, so a picked customer property is
   * one choice rather than a path to type.
   */
  const upstream = $derived.by<FlowOption[]>(() => {
    if (!step) return [];
    return stepsBefore(graph.steps, step.id)
      .flatMap((earlier) => {
        if (earlier.kind !== "action") return [];
        const action = actions.get(earlier.action);
        const output = action?.output_schema as Schema | undefined;
        return Object.entries(output?.properties ?? {}).flatMap(
          ([name, property]) => {
            const from = property["x-keys-from"];
            const keys =
              from && Array.isArray(earlier.params[from])
                ? (earlier.params[from] as unknown[]).map(String)
                : [];
            const at = (path: string) => ({
              value: `steps.${earlier.id}.${path}`,
              label: `${earlier.id}.${path}`,
              hint: action?.title,
            });
            return [...keys.map((key) => at(`${name}.${key}`)), at(name)];
          },
        );
      })
      .reverse();
  });
  /** `item.*` and what each earlier step returns, for `{{…}}`. */
  const variables = $derived([...upstream, ...itemFields]);

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
  const asText = (v: unknown) => (v == null ? "" : String(v));
  const events = (t: FlowTrigger): string[] =>
    Array.isArray(t.params.events) && t.params.events.length
      ? (t.params.events as string[])
      : ["created", "updated"];
  function toggleEvent(target: FlowTrigger, eventName: string, on: boolean) {
    const now = new Set(events(target));
    if (on) now.add(eventName);
    else now.delete(eventName);
    if (!now.size) return;
    setTrigger({ ...target, params: { ...target.params, events: [...now] } });
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
  const setWhere = (target: FlowTrigger, where: Condition | undefined) => {
    const next = { ...target };
    if (where) next.where = where;
    else delete next.where;
    setTrigger(next);
  };
  const triggerConnection = (t: FlowTrigger) =>
    asText(t.params.connection) || connection;

  const show = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
</script>

<div class="inspector">
  {#if trigger}
    {@const openTrigger = trigger}
    <header>
      <span class="what">trigger</span>
      <span class="id">{openTrigger.id}</span>
    </header>
    <Field label="trigger">
      <Select
        value={openTrigger.kind}
        options={KINDS}
        aria-label="Trigger kind"
        onchange={(k) =>
          setTrigger({
            id: openTrigger.id,
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
    {#if openTrigger.kind === "item.synced" || openTrigger.kind === "schedule"}
      <Field
        label="connection"
        required={openTrigger.kind === "item.synced"}
        info={openTrigger.kind === "schedule"
          ? "With one, the flow runs once per recent item of it that passes the condition; without, once on its own."
          : undefined}
      >
        <OptionSelect
          source="connections"
          value={asText(openTrigger.params.connection)}
          label="Connection"
          onchange={(v) => setParam(openTrigger, "connection", v)}
        />
      </Field>
    {/if}
    {#if openTrigger.kind === "item.synced"}
      <Field label="events" plain>
        <span class="events">
          {#each ["created", "updated"] as eventName (eventName)}
            <span class="event">
              <Checkbox
                checked={events(openTrigger).includes(eventName)}
                ariaLabel={eventName}
                onchange={(on) => toggleEvent(openTrigger, eventName, on)}
              />
              {eventName}
            </span>
          {/each}
        </span>
      </Field>
    {:else if openTrigger.kind === "schedule"}
      <Field
        label="schedule"
        required
        info="cron: minute hour day month weekday"
      >
        <input
          value={asText(openTrigger.params.cron)}
          oninput={(e) => setParam(openTrigger, "cron", e.currentTarget.value)}
        />
      </Field>
      <Field label="timezone">
        <input
          value={asText(openTrigger.params.timezone ?? "UTC")}
          oninput={(e) =>
            setParam(openTrigger, "timezone", e.currentTarget.value)}
        />
      </Field>
      {#if openTrigger.params.connection}
        <Field
          label="lookback days"
          info="only items changed within this many days"
        >
          <input
            inputmode="numeric"
            value={asText(openTrigger.params.since_days ?? 7)}
            oninput={(e) =>
              setParam(
                openTrigger,
                "since_days",
                Number(e.currentTarget.value) || undefined,
              )}
          />
        </Field>
        <Field label="max items" info="per run">
          <input
            inputmode="numeric"
            value={asText(openTrigger.params.max_items ?? 50)}
            oninput={(e) =>
              setParam(
                openTrigger,
                "max_items",
                Number(e.currentTarget.value) || undefined,
              )}
          />
        </Field>
      {/if}
    {/if}
    {#if openTrigger.kind !== "manual"}
      <Group label="filter" hint="runs only for items that match">
        {#if openTrigger.where}
          <ConditionEditor
            value={openTrigger.where}
            connection={triggerConnection(openTrigger)}
            onchange={(c) => setWhere(openTrigger, c)}
            onremove={() => setWhere(openTrigger, undefined)}
          />
        {:else}
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onclick={() => setWhere(openTrigger, { all: [newCondition()] })}
            >add a condition</Button
          >
        {/if}
      </Group>
    {/if}
  {:else if step}
    {@const openStep = step}
    <header>
      <span class="what"
        >{openStep.kind === "action"
          ? (action?.title ?? openStep.action)
          : openStep.kind === "if"
            ? "if / else"
            : "only if"}</span
      >
      <span class="id">{openStep.id}</span>
    </header>
    {#if action?.description}<Note>{action.description}</Note>{/if}
    {#if openStep.kind === "action" && !action}
      <Note tone="danger"
        >'{openStep.action}' is not in the library any more.</Note
      >
    {/if}
    <Field
      label="name"
      info="what the canvas shows; the step's kind when empty"
    >
      <input
        value={openStep.label ?? ""}
        oninput={(e) =>
          setStep({ ...openStep, label: e.currentTarget.value || undefined })}
      />
    </Field>
    {#if openStep.kind === "action" && action}
      {#if Object.keys((action.params_schema as Schema).properties ?? {}).length}
        <Group label="settings">
          <SchemaForm
            schema={action.params_schema as Schema}
            value={openStep.params}
            {variables}
            context={connection ? { connection } : {}}
            onchange={(params) => setStep({ ...openStep, params })}
          />
        </Group>
      {/if}
    {:else if openStep.kind === "if" || openStep.kind === "filter"}
      <Group
        label={openStep.kind === "if" ? "condition" : "continue when"}
        hint={openStep.kind === "if"
          ? "matches go to then, the rest to else; both end the flow"
          : "the run stops here when this does not match"}
      >
        <ConditionEditor
          value={"all" in openStep.when || "any" in openStep.when
            ? openStep.when
            : { all: [openStep.when] }}
          {connection}
          fields={upstream}
          onchange={(when) => setStep({ ...openStep, when })}
        />
      </Group>
    {/if}
    {#if trace}
      <Group label="last run">
        <section class="trace">
          <span class="what"
            >{trace.status}{trace.held !== undefined
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
      </Group>
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
