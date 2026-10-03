<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type {
    Flow,
    FlowActionInfo,
    FlowGraph,
    FlowOption,
    FlowRun,
    FlowStep,
    FlowStepStatus,
    FlowTrigger,
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
  });

  $effect(() => {
    const id = flowId;
    const f = flows.find((x) => x.id === id);
    const next: Draft | null =
      id === NEW
        ? blank()
        : f
          ? {
              id: f.id,
              name: f.name,
              team: f.team_slug,
              enabled: f.enabled,
              graph: f.graph,
            }
          : null;
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

  /* ---- editing ------------------------------------------------------------ */

  let selection = $state<Selection | null>(null);
  let palette = $state<{ anchor: HTMLElement; slot: Slot } | null>(null);
  let triggerMenu = $state<HTMLElement | null>(null);

  const setGraph = (g: FlowGraph) => draft && (draft.graph = g);

  function newStep(p: Pick, graph: FlowGraph): FlowStep {
    if (p.kind === "if")
      return {
        id: freshId(graph, "if"),
        kind: "if",
        when: { all: [newCondition()] },
        then: [],
        else: [],
      };
    if (p.kind === "filter")
      return {
        id: freshId(graph, "only-if"),
        kind: "filter",
        when: { all: [newCondition()] },
      };
    return {
      id: freshId(graph, p.action.key.split(".").pop() ?? "step"),
      kind: "action",
      action: p.action.key,
      params: {},
    };
  }

  function place(p: Pick) {
    if (!draft || !palette) return;
    const step = newStep(p, draft.graph);
    setGraph(insertStep(draft.graph, palette.slot, step));
    palette = null;
    selection = { kind: "step", id: step.id };
  }

  const TRIGGER_ICONS: Record<FlowTrigger["kind"], IconName> = {
    "item.synced": "triggerSynced",
    manual: "triggerManual",
    schedule: "triggerSchedule",
  };
  function addTrigger(kind: FlowTrigger["kind"]) {
    if (!draft) return;
    const id = freshId(
      draft.graph,
      kind === "item.synced"
        ? "synced"
        : kind === "schedule"
          ? "schedule"
          : "by-hand",
    );
    const firstConn = connection;
    const params =
      kind === "schedule"
        ? { cron: "0 7 * * 1-5", timezone: "UTC" }
        : kind === "item.synced"
          ? firstConn
            ? { connection: firstConn }
            : {}
          : {};
    setGraph({
      ...draft.graph,
      triggers: [...draft.graph.triggers, { id, kind, params }],
    });
    triggerMenu = null;
    selection = { kind: "trigger", id };
  }

  function outsideTriggerMenu(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (triggerMenu && !t.closest(".trigger-menu") && !triggerMenu.contains(t))
      triggerMenu = null;
  }

  /* ---- saving and running -------------------------------------------------- */

  let saving = $state(false);
  let error = $state<string | null>(null);

  async function save() {
    if (!draft) return;
    saving = true;
    error = null;
    const body = {
      name: draft.name,
      team: draft.team || null,
      enabled: draft.enabled,
      graph: draft.graph,
    };
    try {
      const f = draft.id
        ? await api.put<Flow>(`/flows/${draft.id}`, body)
        : await api.post<Flow>("/flows", body);
      await loadFlows(f.id);
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
      disabled={!draft.id || dirty}
      title={dirty ? "save first" : "run it on an item"}
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
      disabled={!dirty}
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
    {@const d = draft}
    <label class="field">
      <span class="k">name</span>
      <input class="name" bind:value={d.name} aria-label="Flow name" />
    </label>
    <span class="field">
      <span class="k">team</span>
      <span class="pick">
        <Select
          value={d.team ?? ""}
          options={teamOptions}
          searchable
          aria-label="Team"
          onchange={(v) => (d.team = String(v ?? "") || null)}
        />
      </span>
    </span>
    <span class="end loud">
      <Button
        variant="ghost"
        size="sm"
        icon={d.enabled ? "power" : "pause"}
        morph
        tone={d.enabled ? "ok" : "warn"}
        aria-pressed={d.enabled}
        title={d.enabled ? "runs on its triggers; pause it" : "switch it on"}
        onclick={() => (d.enabled = !d.enabled)}
        >{d.enabled ? "on" : "paused"}</Button
      >
      {#if d.id}
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
    {#each Object.keys(TRIGGER_TITLES) as k (k)}
      {@const kind = k as FlowTrigger["kind"]}
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
