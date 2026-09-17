<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Badge, Button, GroupHead, Note, Select } from "../tui";

  type Check = { name: string; state: string; detail: string };
  type Target = { name: string; url: string; dev: boolean };
  type ScriptRule = { script: string; any_time: boolean; dev_only: boolean };
  type TestRun = {
    id: string;
    script: string;
    profile: string | null;
    target: string;
    status: string;
    image_sha: string | null;
    summary: Record<string, any> | null;
    output_tail: string;
    created_at: string;
    finished_at: string | null;
  };

  let checks = $state<Check[] | null>(null);
  let checking = $state(false);
  let runs = $state<TestRun[]>([]);
  let targets = $state<Target[]>([]);
  let scripts = $state<ScriptRule[]>([]);
  let inWindow = $state(false);
  let script = $state("smoke.js");
  let target = $state("");
  let stress = $state(false);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let open = $state(new Set<string>());

  const ACTIVE = new Set(["queued", "running"]);
  const tone = (s: string) =>
    s === "pass" || s === "passed" ? "ok" : s === "warn" ? "warn" : s === "skip" ? "muted" : s === "fail" || s === "failed" || s === "error" ? "danger" : "muted";
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  async function loadRuns() {
    const res = await api.get<{
      runs: TestRun[];
      targets: Target[];
      scripts: ScriptRule[];
      in_window: boolean;
    }>("/tests/runs");
    runs = res.runs;
    targets = res.targets;
    scripts = res.scripts;
    inWindow = res.in_window;
    if (!target && targets.length) target = targets[0].name;
  }

  async function runChecks() {
    checking = true;
    error = null;
    try {
      checks = (await api.get<{ checks: Check[] }>("/tests/checks")).checks;
    } catch (e) {
      error = errText(e);
    } finally {
      checking = false;
    }
  }

  async function start() {
    starting = true;
    error = null;
    try {
      await api.post("/tests/runs", {
        script,
        target,
        profile: stress ? "stress" : null,
      });
      await loadRuns();
    } catch (e) {
      error = errText(e);
    } finally {
      starting = false;
    }
  }

  async function cancel(run: TestRun) {
    try {
      await api.post(`/tests/runs/${run.id}/cancel`, {});
      await loadRuns();
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

  /** p95 per endpoint from k6's summary, which is what a release is compared on. */
  function latencies(run: TestRun): string {
    const metrics = (run.summary?.metrics ?? {}) as Record<string, any>;
    return Object.entries(metrics)
      .filter(([name]) => name.startsWith("http_req_duration{endpoint:"))
      .map(([name, m]) => `${name.slice(27, -1)} ${Math.round(m["p(95)"] ?? 0)} ms`)
      .join(" · ");
  }

  const chosen = $derived(scripts.find((s) => s.script === script));
  const chosenTarget = $derived(targets.find((t) => t.name === target));
  const blocked = $derived.by(() => {
    if (!chosenTarget) return "no target is configured (TACHY_LOAD_TARGETS)";
    if (chosenTarget.dev) return null;
    if (chosen?.dev_only) return `${script} runs only against a dev target`;
    if (stress) return "stress runs only against a dev target";
    if (!chosen?.any_time && !inWindow)
      return `${script} may only run against ${target} outside working hours`;
    return null;
  });

  let poll: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    const active = runs.some((r) => ACTIVE.has(r.status));
    if (active && !poll) poll = setInterval(() => void loadRuns(), 3000);
    if (!active && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  });
  onDestroy(() => poll && clearInterval(poll));
  onMount(() => {
    void loadRuns().catch((e) => (error = errText(e)));
    void runChecks();
  });
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}

<GroupHead label="checks" />
<div class="row">
  <Button variant="ghost" size="sm" icon="test" busy={checking} onclick={runChecks}>run checks</Button>
  <span class="muted">what varies between environments; CI already ran the suite on this commit</span>
</div>
{#if checks}
  <table>
    <tbody>
      {#each checks as c (c.name)}
        <tr><td>{c.name}</td><td><Badge tone={tone(c.state)}>{c.state}</Badge></td><td class="muted">{c.detail}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}

<GroupHead label="load runs" />
<div class="row">
  <Select
    value={script}
    options={scripts.map((s) => ({ value: s.script, label: s.script }))}
    aria-label="script"
    onchange={(v) => (script = String(v))}
  />
  <Select
    value={target}
    options={targets.map((t) => ({ value: t.name, label: `${t.name}${t.dev ? " (dev)" : ""}` }))}
    aria-label="target"
    onchange={(v) => (target = String(v))}
  />
  <label class="muted"><input type="checkbox" bind:checked={stress} /> stress profile</label>
  <Button variant="ghost" tone="ok" size="sm" icon="index" busy={starting} disabled={Boolean(blocked)} onclick={start}>start</Button>
</div>
{#if blocked}<Note>{blocked}</Note>{/if}

<table>
  <thead><tr><th>script</th><th>target</th><th>status</th><th>latency</th><th></th></tr></thead>
  <tbody>
    {#each runs as r (r.id)}
      <tr>
        <td>{r.script}{r.profile ? ` (${r.profile})` : ""}<span class="muted small">{when(r.created_at)}</span></td>
        <td>{r.target}<span class="muted small">{r.image_sha ?? "unknown build"}</span></td>
        <td><Badge tone={tone(r.status)}>{r.status}</Badge></td>
        <td class="muted">{latencies(r)}</td>
        <td class="acts">
          {#if r.output_tail}
            <Button variant="ghost" size="sm" onclick={() => toggle(r.id)}>{open.has(r.id) ? "hide" : "output"}</Button>
          {/if}
          {#if ACTIVE.has(r.status)}
            <Button variant="ghost" size="sm" tone="danger" onclick={() => cancel(r)}>cancel</Button>
          {/if}
        </td>
      </tr>
      {#if open.has(r.id)}
        <tr><td colspan="5"><pre class="log">{r.output_tail}</pre></td></tr>
      {/if}
    {:else}
      <tr><td colspan="5" class="muted">No load runs yet.</td></tr>
    {/each}
  </tbody>
</table>

<style>
  .row { display: flex; align-items: center; gap: var(--pad-2); flex-wrap: wrap; margin-bottom: var(--pad-2); }
  .muted { color: var(--muted); }
  .small { display: block; font-size: 0.85em; }
  .acts { text-align: end; white-space: nowrap; }
  .log { max-height: 20rem; overflow: auto; margin: 0; padding: var(--pad-2); border: 1px dashed var(--border); white-space: pre-wrap; font-size: 0.85em; }
</style>
