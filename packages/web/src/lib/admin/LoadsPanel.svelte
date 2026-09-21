<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Bars, Badge, Button, Checkbox, GroupHead, Note, Select, isActive, toneOf, type Bar } from "../tui";
  import { fmtDateTime } from "../dates";
  import { endpointP95, loadSummary, type TestRun } from "./loadRuns";
  import { pct } from "./overview";
  import { loads } from "./systemState.svelte";

  let script = $state("smoke.js");
  let target = $state("");
  let stress = $state(false);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let open = $state(new Set<string>());

  const runs = $derived(loads.data.runs);
  const summary = $derived(loadSummary(runs));

  /* Which scripts get run, and how often each passes. The stress share rides
     on the bar, because a script that only ever passes unstressed has not
     been tested the way its name suggests. */
  const byScript = $derived(
    summary.byScript.map(
      (s): Bar => ({
        key: s.script,
        label: s.script,
        value: s.runs,
        parts: [
          { key: "passed", value: s.passed, tone: "ok" },
          { key: "other", value: Math.max(0, s.runs - s.passed), tone: "muted" },
        ],
      }),
    ),
  );

  $effect(() => {
    if (!target && loads.data.targets.length) target = loads.data.targets[0].name;
  });

  async function start() {
    starting = true;
    error = null;
    try {
      await api.post("/tests/runs", {
        script,
        target,
        profile: stress ? "stress" : null,
      });
      await loads.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      starting = false;
    }
  }

  async function cancel(run: TestRun) {
    try {
      await api.post(`/tests/runs/${run.id}/cancel`, {});
      await loads.reload();
    } catch (e) {
      error = errText(e);
    }
  }

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    open = next;
  }

  const latencies = (run: TestRun) =>
    endpointP95(run)
      .map((e) => `${e.endpoint} ${e.ms} ms`)
      .join(" · ");

  const chosen = $derived(loads.data.scripts.find((s) => s.script === script));
  const chosenTarget = $derived(loads.data.targets.find((t) => t.name === target));
  const blocked = $derived.by(() => {
    if (!chosenTarget) return "no target (TACHY_LOAD_TARGETS)";
    if (chosenTarget.dev) return null;
    if (chosen?.dev_only) return `${script}: dev targets only`;
    if (stress) return "stress: dev targets only";
    if (!chosen?.any_time && !loads.data.in_window)
      return `${script} on ${target}: outside working hours only`;
    return null;
  });

  let poll: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    const active = runs.some((r) => isActive(r.status));
    if (active && !poll) poll = setInterval(() => void loads.reload(), 3000);
    if (!active && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });
  onDestroy(() => poll && clearInterval(poll));
  onMount(() => void loads.reload());
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}
{#if loads.error}<Note tone="danger">{loads.error}</Note>{/if}

<div class="row">
  <Select
    value={script}
    options={loads.data.scripts.map((s) => ({ value: s.script, label: s.script }))}
    aria-label="script"
    onchange={(v) => (script = String(v))}
  />
  <Select
    value={target}
    options={loads.data.targets.map((t) => ({
      value: t.name,
      label: `${t.name}${t.dev ? " (dev)" : ""}`,
    }))}
    aria-label="target"
    onchange={(v) => (target = String(v))}
  />
  <span class="opt dim">
    <Checkbox bind:checked={stress} ariaLabel="stress profile" /> stress profile
  </span>
  <Button
    variant="ghost"
    tone="ok"
    size="sm"
    icon="run"
    busy={starting}
    disabled={Boolean(blocked)}
    onclick={start}>start</Button
  >
</div>
{#if blocked}<Note>{blocked}</Note>{/if}

{#if summary.runs}
  <div class="stats">
    <span><b>{summary.runs}</b> runs</span>
    <span
      ><b>{summary.passRate === null ? "–" : pct(summary.passed, summary.judged)}</b>
      passed{summary.judged < summary.runs ? ` of ${summary.judged} finished` : ""}</span
    >
    <span><b>{summary.stress}</b> under stress</span>
  </div>
  <GroupHead label="by script" />
  <div class="bars"><Bars rows={byScript} limit={8} /></div>
{/if}

<GroupHead label="runs" />
<table class="runs">
  <tbody>
    {#each runs as r (r.id)}
      <tr>
        <td>
          {r.script}{r.profile ? ` (${r.profile})` : ""}
          <span class="dim small">{fmtDateTime(r.created_at)}</span>
        </td>
        <td>{r.target}<span class="dim small">{r.image_sha ?? "unknown build"}</span></td>
        <td><Badge tone={toneOf(r.status)}>{r.status}</Badge></td>
        <td class="dim">{latencies(r)}</td>
        <td class="acts">
          {#if r.output_tail}
            <Button variant="ghost" size="sm" onclick={() => toggle(r.id)}
              >{open.has(r.id) ? "hide" : "output"}</Button
            >
          {/if}
          {#if isActive(r.status)}
            <Button variant="ghost" size="sm" tone="danger" icon="stop" onclick={() => cancel(r)}
              >stop</Button
            >
          {/if}
        </td>
      </tr>
      {#if open.has(r.id)}
        <tr><td colspan="5"><pre class="log">{r.output_tail}</pre></td></tr>
      {/if}
    {:else}
      <tr><td colspan="5" class="dim">no load runs</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    flex-wrap: wrap;
    margin-bottom: var(--pad-2);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .stats {
    display: flex;
    gap: var(--pad-4);
    margin: var(--pad-3) 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .stats b {
    color: var(--text);
    font-family: var(--font-mono);
    font-weight: 400;
  }
  .bars {
    margin-bottom: var(--pad-3);
  }
  .dim {
    color: var(--muted);
  }
  .small {
    display: block;
    font-size: 0.85em;
  }
  .runs {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  .runs td {
    padding: var(--pad-1) var(--pad-2);
    vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }
  .acts {
    text-align: end;
    white-space: nowrap;
  }
  .log {
    max-height: 20rem;
    overflow: auto;
    margin: 0;
    padding: var(--pad-2);
    border: 1px dashed var(--border);
    white-space: pre-wrap;
    font-size: 0.85em;
  }
</style>
