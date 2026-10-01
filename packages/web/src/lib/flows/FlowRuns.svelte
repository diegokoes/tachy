<script lang="ts">
  import type { FlowRun } from "@tachy/contract";
  import { api } from "../api";
  import { Badge, Note, Time } from "../tui";

  let {
    flowId,
    refresh = 0,
    selected,
    onpick,
  }: {
    flowId: string;
    /** Bumped after queueing a run, to read the list again at once. */
    refresh?: number;
    selected: string | null;
    onpick: (run: FlowRun | null) => void;
  } = $props();

  let runs = $state<FlowRun[]>([]);
  let error = $state<string | null>(null);

  async function load(id: string) {
    try {
      const got = await api.get<FlowRun[]>(`/flows/${id}/runs`);
      if (id !== flowId) return;
      runs = got;
      error = null;
      const open = got.find((r) => r.id === selected);
      if (open) onpick(open);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /* Runs are queued jobs, so a new one shows up a moment after it is asked
     for; the list is read again every few seconds while anything moves. */
  $effect(() => {
    const id = flowId;
    refresh;
    void load(id);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      if (ticks < 10 || runs.some((r) => r.status === "running")) void load(id);
    }, 3000);
    return () => clearInterval(timer);
  });

  const TONES = {
    running: "info",
    succeeded: "ok",
    failed: "danger",
    stopped: "muted",
  } as const;
</script>

<div class="runs">
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#each runs as r (r.id)}
    <button
      class="run"
      class:sel={r.id === selected}
      onclick={() => onpick(r.id === selected ? null : r)}
    >
      <Badge tone={TONES[r.status]}>{r.status}</Badge>
      {#if r.dry_run}<Badge tone="warn">dry</Badge>{/if}
      <span class="when"><Time at={r.started_at} /></span>
      <span class="trig">{r.trigger_id ?? "by hand"}</span>
    </button>
  {:else}
    <p class="none">No runs yet. Try it on an item with test run.</p>
  {/each}
</div>

<style>
  .runs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .run {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) var(--pad-2);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .run:hover {
    border-color: var(--border);
  }
  .run.sel {
    border-color: var(--accent);
  }
  .when {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .trig {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .none {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
</style>
