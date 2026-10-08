<script lang="ts">
  import { isCurator } from "../access/session.svelte";
  import { untrack, type Snippet } from "svelte";
  import {
    FLOW_MODEL_CALLS_PER_DAY,
    type Flow,
    type FlowActionInfo,
    type FlowGraph,
    type FlowOption,
    type FlowRun,
    type FlowStep,
    type FlowStepStatus,
    type FlowTrigger,
  } from "@tachy/contract";
  import { api } from "../api";
  import { setPageActions } from "../admin/pageActions.svelte";
  import { keep, recall } from "../shell/kept";
  import Group from "../settings/Group.svelte";
  import {
    Button,
    Checkbox,
    DeleteButton,
    float,
    Icon,
    Note,
    Select,
    type IconName,
  } from "../tui";
  import ActionPalette from "./ActionPalette.svelte";
  import FlowCanvas from "./FlowCanvas.svelte";
  import FlowInspector from "./FlowInspector.svelte";
  import FlowRuns from "./FlowRuns.svelte";
  import {
    freshId,
    insertStep,
    newCondition,
    TRIGGER_TITLES,
    type Pick,
    type Selection,
    type Slot,
  } from "./graph";
  import OptionSelect from "./OptionSelect.svelte";
  import { fetchActions, fetchOptions } from "./options.svelte";

  let { lead }: { lead: Snippet } = $props();

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const NEW = "__new";

  interface Draft {
    id: string | null;
    name: string;
    team: string | null;
    enabled: boolean;
    graph: FlowGraph;
    /** Kept as typed, so a half-typed number is not rewritten under the caret. */
    modelCalls: string;
  }

  let flows = $state<Flow[]>([]);
  let listError = $state<string | null>(null);
  let flowId = $state(recall("admin.flows.flow", ""));
  $effect(() => keep("admin.flows.flow", flowId));

  let actionList = $state<FlowActionInfo[]>([]);
  const actions = $derived(new Map(actionList.map((a) => [a.key, a])));
  let teams = $state<FlowOption[]>([]);

  async function loadFlows(pick?: string) {
    try {
      flows = await api.get<Flow[]>("/flows");
      listError = null;
      if (pick) flowId = pick;
      else if (!flows.some((f) => f.id === flowId) && flowId !== NEW)
        flowId = flows[0]?.id ?? NEW;
    } catch (e) {
      listError = errText(e);
    }
  }
  $effect(() => {
    void loadFlows();
    fetchActions()
      .then((a) => (actionList = a))
      .catch((e) => (listError = errText(e)));
    fetchOptions("teams")
      .then((t) => (teams = t))
      .catch(() => (teams = []));
  });

  let draft = $state<Draft | null>(null);
  let saved = $state("");
  const dirty = $derived(!!draft && JSON.stringify(draft) !== saved);

  const blank = (): Draft => ({
    id: null,
    name: "new flow",
    team: untrack(() => teams[0]?.value ?? null),
    enabled: false,
    graph: {
      triggers: [{ id: "by-hand", kind: "manual", params: {} }],
      steps: [],
    },
    modelCalls: String(FLOW_MODEL_CALLS_PER_DAY),
  });
  const draftOf = (flow: Flow): Draft => ({
    id: flow.id,
    name: flow.name,
    team: flow.team_slug,
    enabled: flow.enabled,
    graph: flow.graph,
    modelCalls: String(flow.model_calls_per_day),
  });

  $effect(() => {
    const id = flowId;
    const stored = flows.find((x) => x.id === id);
    let next: Draft | null = null;
    if (id === NEW) next = blank();
    else if (stored) next = draftOf(stored);
    draft = next;
    saved = id === NEW ? "" : JSON.stringify(next);
    selection = null;
    run = null;
  });

  const flowOptions = $derived([
    ...flows.map((f) => ({
      value: f.id,
      label: f.name,
      hint: `${f.team_slug ?? "global"}${f.enabled ? "" : " · paused"}`,
    })),
    { value: NEW, label: "+ new flow" },
  ]);
  const teamOptions = $derived([
    { value: "", label: "global", hint: "app admins only" },
    ...teams,
  ]);

  /** Whose items the pickers read: the first trigger that names a connection. */
  const connection = $derived(
    String(
      draft?.graph.triggers.find((t) => t.params.connection)?.params
        .connection ?? "",
    ),
  );

  let selection = $state<Selection | null>(null);
  let palette = $state<{ anchor: HTMLElement; slot: Slot } | null>(null);
  let triggerMenu = $state<HTMLElement | null>(null);

  const setGraph = (g: FlowGraph) => draft && (draft.graph = g);

  function newStep(pick: Pick, graph: FlowGraph): FlowStep {
    if (pick.kind === "if")
      return {
        id: freshId(graph, "if"),
        kind: "if",
        when: { all: [newCondition()] },
        then: [],
        else: [],
      };
    if (pick.kind === "filter")
      return {
        id: freshId(graph, "only-if"),
        kind: "filter",
        when: { all: [newCondition()] },
      };
    return {
      id: freshId(graph, pick.action.key.split(".").pop() ?? "step"),
      kind: "action",
      action: pick.action.key,
      params: {},
    };
  }

  function place(pick: Pick) {
    if (!draft || !palette) return;
    const step = newStep(pick, draft.graph);
    setGraph(insertStep(draft.graph, palette.slot, step));
    palette = null;
    selection = { kind: "step", id: step.id };
  }

  const TRIGGER_ICONS: Record<FlowTrigger["kind"], IconName> = {
    "item.synced": "triggerSynced",
    manual: "triggerManual",
    schedule: "triggerSchedule",
  };
  const TRIGGER_IDS: Record<FlowTrigger["kind"], string> = {
    "item.synced": "synced",
    manual: "by-hand",
    schedule: "schedule",
  };
  function startParams(kind: FlowTrigger["kind"]): FlowTrigger["params"] {
    if (kind === "schedule") return { cron: "0 7 * * 1-5", timezone: "UTC" };
    if (kind === "item.synced" && connection) return { connection };
    return {};
  }
  function addTrigger(kind: FlowTrigger["kind"]) {
    if (!draft) return;
    const id = freshId(draft.graph, TRIGGER_IDS[kind]);
    const params = startParams(kind);
    setGraph({
      ...draft.graph,
      triggers: [...draft.graph.triggers, { id, kind, params }],
    });
    triggerMenu = null;
    selection = { kind: "trigger", id };
  }

  function outsideTriggerMenu(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (
      triggerMenu &&
      !target.closest(".trigger-menu") &&
      !triggerMenu.contains(target)
    )
      triggerMenu = null;
  }

  let saving = $state(false);
  let error = $state<string | null>(null);

  const modelCalls = $derived(
    draft && /^\d+$/.test(draft.modelCalls.trim())
      ? Number(draft.modelCalls)
      : null,
  );
  const callsToday = $derived(
    flows.find((f) => f.id === draft?.id)?.model_calls_today ?? 0,
  );

  async function save() {
    if (!draft) return;
    if (modelCalls === null) {
      error = "model calls a day must be a whole number, 0 or more";
      return;
    }
    saving = true;
    error = null;
    const body = {
      name: draft.name,
      team: draft.team || null,
      enabled: draft.enabled,
      graph: draft.graph,
      model_calls_per_day: modelCalls ?? undefined,
    };
    try {
      const written = draft.id
        ? await api.put<Flow>(`/flows/${draft.id}`, body)
        : await api.post<Flow>("/flows", body);
      await loadFlows(written.id);
      saved = JSON.stringify(draft);
    } catch (e) {
      error = errText(e);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!draft?.id) return;
    try {
      await api.delete(`/flows/${draft.id}`);
      flowId = "";
      await loadFlows();
    } catch (e) {
      error = errText(e);
    }
  }

  let testAnchor = $state<HTMLElement | null>(null);
  let testItem = $state("");
  let testDry = $state(true);
  let refresh = $state(0);

  async function testRun() {
    if (!draft?.id) return;
    error = null;
    try {
      await api.post(`/flows/${draft.id}/run`, {
        work_item_id: testItem || undefined,
        dry_run: testDry,
      });
      testAnchor = null;
      refresh++;
    } catch (e) {
      error = errText(e);
    }
  }

  let run = $state<FlowRun | null>(null);
  const statuses = $derived(
    run
      ? new Map<string, FlowStepStatus | "held" | "not held">(
          run.steps.map((s) => [
            s.step_id,
            s.kind === "filter" && s.held === false ? "not held" : s.status,
          ]),
        )
      : null,
  );
  const trace = $derived(
    run && selection?.kind === "step"
      ? (run.steps.find((s) => s.step_id === selection!.id) ?? null)
      : null,
  );

  $effect(() => setPageActions(topActions));
</script>

{#snippet topActions()}
  {#if draft}
    <Button
      variant="ghost"
      size="sm"
      icon="test"
      disabled={!draft.id || dirty || !isCurator()}
      onclick={(e) =>
        (testAnchor = testAnchor
          ? null
          : ((e?.currentTarget as HTMLElement) ?? null))}>test run</Button
    >
    <Button
      variant="ghost"
      size="sm"
      icon="save"
      tone={dirty ? "accent" : undefined}
      busy={saving}
      disabled={!dirty || !isCurator()}
      onclick={save}>save</Button
    >
  {/if}
{/snippet}

<svelte:window onpointerdown={outsideTriggerMenu} />

<header class="bar">
  {@render lead()}
  <span class="pick wide">
    <Select
      value={flowId}
      options={flowOptions}
      searchable
      placeholder="flow"
      aria-label="Flow"
      onchange={(v) => (flowId = String(v ?? ""))}
    />
  </span>
  {#if draft && !listError}
    {@const edited = draft}
    <label class="field">
      <span class="k">name</span>
      <input class="name" bind:value={edited.name} aria-label="Flow name" />
    </label>
    <span class="field">
      <span class="k">team</span>
      <span class="pick">
        <Select
          value={edited.team ?? ""}
          options={teamOptions}
          searchable
          aria-label="Team"
          onchange={(v) => (edited.team = String(v ?? "") || null)}
        />
      </span>
    </span>
    <label class="field">
      <span class="k">model calls a day</span>
      <input
        class="calls"
        inputmode="numeric"
        bind:value={edited.modelCalls}
        aria-label="Model calls a day"
      />
      {#if edited.id}<span class="k">{callsToday} used</span>{/if}
    </label>
    <span class="end loud">
      <Button
        variant="ghost"
        size="sm"
        icon={edited.enabled ? "power" : "pause"}
        morph
        tone={edited.enabled ? "ok" : "warn"}
        aria-pressed={edited.enabled}
        onclick={() => (edited.enabled = !edited.enabled)}
        >{edited.enabled ? "on" : "paused"}</Button
      >
      {#if edited.id && isCurator()}
        <DeleteButton label="delete flow" text="delete" onclick={remove} />
      {/if}
    </span>
  {/if}
</header>

{#if error}<Note tone="danger">{error}</Note>{/if}
{#if listError}
  <Note tone="danger">{listError}</Note>
{:else if draft}
  <div class="work">
    <div class="canvas">
      <FlowCanvas
        graph={draft.graph}
        {actions}
        selected={selection}
        {statuses}
        onselect={(s) => (selection = s)}
        onslot={(slot, anchor) => (palette = { slot, anchor })}
        onaddtrigger={(anchor) => (triggerMenu = triggerMenu ? null : anchor)}
      />
    </div>
    <aside class="side">
      {#if selection}
        {#key `${selection.kind}:${selection.id}`}
          <FlowInspector
            graph={draft.graph}
            {selection}
            {actions}
            {connection}
            {trace}
            onchange={setGraph}
            onselect={(s) => (selection = s)}
          />
        {/key}
      {/if}
      {#if draft.id}
        <Group label="runs">
          <FlowRuns
            flowId={draft.id}
            {refresh}
            selected={run?.id ?? null}
            onpick={(r) => (run = r)}
          />
        </Group>
      {/if}
    </aside>
  </div>
{/if}

{#if palette}
  <ActionPalette
    anchor={palette.anchor}
    actions={actionList}
    onpick={place}
    onclose={() => (palette = null)}
  />
{/if}

{#if triggerMenu}
  <div
    class="menu trigger-menu"
    role="menu"
    use:float={{ anchor: triggerMenu, placement: "beside", gap: 8 }}
  >
    {#each Object.keys(TRIGGER_TITLES) as key (key)}
      {@const kind = key as FlowTrigger["kind"]}
      <button role="menuitem" onclick={() => addTrigger(kind)}>
        <Icon name={TRIGGER_ICONS[kind]} size="0.9em" />
        {TRIGGER_TITLES[kind]}
      </button>
    {/each}
  </div>
{/if}

{#if testAnchor && draft?.id}
  <div
    class="menu test"
    role="dialog"
    aria-label="Test run"
    use:float={{ anchor: testAnchor, placement: "below-end", gap: 4 }}
  >
    <span class="k">item</span>
    <OptionSelect
      source="work_items"
      deps={connection ? { connection } : {}}
      value={testItem}
      label="Item to run on"
      placeholder="none: run without an item"
      onchange={(v) => (testItem = v)}
    />
    <span class="dry">
      <Checkbox
        checked={testDry}
        ariaLabel="Dry run"
        onchange={(v) => (testDry = v)}
      />
      dry run: writes say what they would do
    </span>
    <Button variant="primary" icon="run" onclick={testRun}>run</Button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2) var(--pad-3);
    padding: var(--pad-3) 0;
    border-bottom: 1px solid var(--border);
  }
  .pick {
    width: 12rem;
    max-width: 100%;
  }
  .pick.wide {
    width: 16rem;
  }
  .pick > :global(*) {
    width: 100%;
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-3);
  }
  .end {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin-left: auto;
  }
  .end :global(.btn) {
    min-height: var(--control-h);
  }
  .loud :global(.btn) {
    text-transform: uppercase;
    letter-spacing: var(--label-spacing);
  }
  .k {
    font-size: var(--fs-xs);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
  }
  .name {
    width: 12rem;
  }
  .calls {
    width: 4.5rem;
  }
  .work {
    flex: 1;
    margin-top: var(--pad-3);
    min-height: 24rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(17rem, 22rem);
    gap: var(--pad-4);
    padding-bottom: var(--pad-3);
  }
  .canvas {
    min-height: 0;
    min-width: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--pad-4);
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--pad-1);
  }
  .menu {
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--pad-1);
    background: var(--panel-bg);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: var(--radius-control);
    box-shadow: 0 4px 14px var(--drop);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-2) var(--pad-3);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--accent-dim);
  }
  .test {
    width: 22rem;
    gap: var(--pad-2);
    padding: var(--pad-3);
  }
  .test > :global(*) {
    width: 100%;
  }
  .dry {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
