<script lang="ts">
  import { utcTip } from "../dates.svelte";
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { navigate } from "../shell/router.svelte";
  import { errText } from "../resource.svelte";
  import {
    Badge,
    Bars,
    Button,
    Cells,
    Checkbox,
    Columns,
    DataTable,
    Modal,
    Note,
    dayOfMonth,
    type Bar,
    type Cell,
    type Col,
    type Column,
  } from "../tui";
  import { loadSummary, runP95 } from "../diagnostics/loadRuns";
  import {
    age,
    bytes,
    load,
    pct,
    ratio,
    showSection,
    span,
    type Count,
    type Tone,
  } from "../admin/overview";
  import Dials, { type DialItem } from "../admin/Dials.svelte";
  import Detail from "../admin/Detail.svelte";
  import { ago as agoText, col } from "../admin/detail";
  import Facts, { type Fact } from "../admin/Facts.svelte";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";
  import { census } from "../admin/census.svelte";
  import {
    loads,
    probes,
    probeTally,
    runProbes,
    system,
  } from "./systemState.svelte";

  type Result = {
    ok?: boolean;
    at?: string;
    error?: string;
    problems?: string;
    dump_bytes?: number;
  };
  type Watch = { checks?: Record<string, { state: string; value: string }> };
  type Host = { disk?: Record<string, string> };

  const HOUR = 3_600_000;

  let now = $state(Date.now());
  let error = $state<string | null>(null);
  let pausing = $state(false);
  /** The lamp whose detail is open, if one is. */
  let lamp = $state<(Cell & { detail?: string }) | null>(null);

  // Current values only, refreshed while the page is open. The probes are not
  // on this clock; see `systemState`.
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void system.reload().then(() => (now = Date.now()));
    void loads.reload();
    if (!probes.checks && !probes.running) void runProbes();
    timer = setInterval(async () => {
      await system.reload();
      now = Date.now();
    }, 10_000);
  });
  onDestroy(() => timer && clearInterval(timer));

  const runtime = $derived(system.data?.runtime ?? null);
  const settings = $derived(system.data?.settings ?? null);
  const status = $derived(
    (runtime?.status ?? null) as Record<string, unknown> | null,
  );
  const backup = $derived(status?.backup as Result | undefined);
  const restore = $derived(status?.restore as Result | undefined);
  const tally = $derived(probeTally(probes.checks));
  const summary = $derived(loadSummary(loads.data.runs));

  /** A host result as a counter: its age, toned by whether it failed or is overdue. */
  const hostCounter = (
    hostResult: Result | undefined,
    overdue: number,
  ): { text: string; tone: Tone } => {
    if (!status) return { text: "–", tone: "muted" };
    if (!hostResult?.at) return { text: "none", tone: "danger" };
    const text = age(hostResult.at, now) ?? "–";
    if (hostResult.ok === false) return { text, tone: "danger" };
    return {
      text,
      tone: now - Date.parse(hostResult.at) > overdue ? "warn" : "ok",
    };
  };

  const disk = $derived.by(() => {
    const used = Object.values((status?.host as Host | undefined)?.disk ?? {})
      .map((v) => parseInt(v, 10))
      .filter(Number.isFinite);
    return used.length ? Math.max(...used) : null;
  });

  const runState = (): { text: string; tone: Tone } => {
    if (!runtime) return { text: "–", tone: "muted" };
    if (runtime.draining) return { text: "draining", tone: "warn" };
    if (!runtime.readiness.ready) return { text: "not ready", tone: "danger" };
    return runtime.refusingChats
      ? { text: "paused", tone: "warn" }
      : { text: "ready", tone: "ok" };
  };
  const tallyText = (counted: number) => {
    if (tally) return `${tally.passing}/${counted}`;
    return probes.running ? "…" : "–";
  };
  const tallyTone = (): Tone => {
    if (!tally) return "muted";
    if (tally.failing) return "danger";
    return tally.warning ? "warn" : "ok";
  };
  const PASS_OK = 0.95;
  const PASS_WARN = 0.8;
  const passTone = (rate: number | null): Tone => {
    if (rate === null) return "muted";
    if (rate >= PASS_OK) return "ok";
    return rate >= PASS_WARN ? "warn" : "danger";
  };

  const figures = $derived.by(() => {
    const state = runState();
    const commit = system.data?.env?.commit;
    const backupCounter = hostCounter(backup, 12 * HOUR);
    const restoreCounter = hostCounter(restore, 8 * 24 * HOUR);
    // A skipped probe ran nothing, so it is out of the denominator too.
    const counted = tally ? tally.total - tally.skipped : 0;
    const openReports = census.data.warn.reports ?? 0;
    let reportsTone: Tone = "muted";
    if (openReports) reportsTone = "warn";
    else if (census.data.counts.reports) reportsTone = "accent";
    return [
      { key: "status", label: "status", ...state, to: "runtime" },
      {
        key: "reports",
        label: "reports",
        value: census.data.counts.reports ?? 0,
        tone: reportsTone,
        to: "reports",
      },
      {
        key: "release",
        label: "release",
        text: commit ? commit.slice(0, 7) : "dev",
        tone: commit ? ("accent" as Tone) : ("muted" as Tone),
      },
      {
        key: "up",
        label: "up",
        text:
          runtime?.uptimeSeconds !== undefined
            ? span(runtime.uptimeSeconds * 1000)
            : "–",
      },
      {
        key: "checks",
        label: "checks",
        text: tallyText(counted),
        tone: tallyTone(),
        to: "checks",
      },
      {
        key: "loads",
        label: "load tests",
        text:
          summary.passRate === null ? "–" : pct(summary.passed, summary.judged),
        tone: passTone(summary.passRate),
        to: "loads",
      },
      { key: "backup", label: "last backup", ...backupCounter, to: "host" },
      { key: "restore", label: "restore test", ...restoreCounter, to: "host" },
      {
        key: "disk",
        label: "disk",
        text: disk === null ? "–" : `${disk}%`,
        tone: disk === null ? ("muted" as Tone) : load(disk / 100),
        to: "host",
      },
    ];
  });

  const gauges = $derived.by((): DialItem[] => {
    if (!runtime) return [];
    const turns = runtime.turns;
    const postgres = "error" in runtime.postgres ? null : runtime.postgres;
    const pgUsed = postgres
      ? postgres.byProcess.reduce((n, p) => n + p.n, 0)
      : 0;
    const mem = runtime.memory;
    const memShare = mem?.maxBytes ? mem.currentBytes / mem.maxBytes : null;
    const loop = runtime.eventLoopP99Ms;
    let memCenter = "–";
    if (memShare !== null) memCenter = `${Math.round(memShare * 100)}%`;
    else if (mem) memCenter = bytes(mem.currentBytes);
    let memSub = "unknown";
    if (mem) memSub = mem.maxBytes ? bytes(mem.currentBytes) : "no limit";
    return [
      {
        key: "slots",
        label: "chat slots",
        title: `${turns.queued} queued · ${turns.rejectedSinceBoot} refused since boot`,
        value: ratio(turns.slotsUsed, turns.slotCap),
        tone: load(ratio(turns.slotsUsed, turns.slotCap)),
        center: pct(turns.slotsUsed, turns.slotCap),
        sub: `${turns.slotsUsed}/${turns.slotCap}`,
      },
      {
        key: "memory",
        label: "memory",
        title:
          memShare === null ? "no container limit" : "of the container limit",
        value: memShare ?? 0,
        tone: memShare === null ? "muted" : load(memShare),
        center: memCenter,
        sub: memSub,
      },
      {
        key: "postgres",
        label: "postgres",
        title: postgres
          ? postgres.byProcess
              .map((p) => `${p.name} ${p.state} ${p.n}`)
              .join(" · ")
          : "unavailable",
        value: postgres ? ratio(pgUsed, postgres.max) : 0,
        tone: postgres ? load(ratio(pgUsed, postgres.max)) : "muted",
        center: postgres ? pct(pgUsed, postgres.max) : "–",
        sub: postgres ? `${pgUsed}/${postgres.max}` : "unknown",
      },
      {
        key: "loop",
        label: "event loop",
        title: "p99 delay over the last minute, against 100 ms",
        value: Math.min(1, loop / 100),
        tone: load(loop / 100),
        center: `${Math.round(loop)} ms`,
        sub: "p99",
      },
    ];
  });

  const LAMP_WORDS: Record<Cell["tone"], string> = {
    ok: "ok",
    warn: "warning",
    danger: "failing",
    muted: "not in use",
  };
  const WATCH_TONES: Record<string, Cell["tone"]> = {
    ok: "ok",
    warn: "warn",
    fail: "danger",
  };
  const PROBE_TONES: Record<string, Cell["tone"]> = {
    pass: "ok",
    warn: "warn",
    fail: "danger",
    skip: "muted",
  };
  const SCHEMA_TONES: Record<string, Cell["tone"]> = {
    match: "ok",
    mismatch: "danger",
    unstamped: "muted",
  };
  const MODEL_TONES: Record<string, Cell["tone"]> = {
    ready: "ok",
    external: "ok",
    unreachable: "danger",
    loading: "warn",
  };
  type Runtime = NonNullable<typeof runtime>;
  /** `off` is the tone of a vault with no key set. */
  const vaultTone = (
    vault: Runtime["security"]["vault"],
    off: Cell["tone"],
  ): Cell["tone"] => {
    if (!vault.enabled) return off;
    return vault.by_key.some((k) => !k.current) ? "warn" : "ok";
  };
  const embedState = (embed: Runtime["embed"]) => {
    if (!embed) return "unknown";
    return embed.running ? "busy" : "idle";
  };

  // One board for every "is this working" answer: the runtime's own readiness
  // lamps, tachy-watch's host checks, and the on-demand probes once run. They
  // answer the same question from different distances.
  const lamps = $derived.by((): (Cell & { detail?: string })[] => {
    if (!runtime) return [];
    const readiness = runtime.readiness;
    const vault = runtime.security.vault;
    const cells: (Cell & { detail?: string })[] = [
      {
        key: "database",
        label: "database",
        tone: readiness.database ? "ok" : "danger",
        title: readiness.database ? "up" : "down",
      },
      {
        key: "schema",
        label: "schema",
        tone: SCHEMA_TONES[readiness.schema] ?? "warn",
        title: readiness.schema,
        detail:
          readiness.schema === "mismatch"
            ? "The database schema does not match what this build expects. Apply db/schema.sql before relying on anything new."
            : undefined,
      },
      {
        key: "model",
        label: "model",
        tone: MODEL_TONES[readiness.model] ?? "muted",
        title: readiness.model,
      },
      {
        key: "vault",
        label: "vault keys",
        tone: vaultTone(vault, "muted"),
        title: vault.enabled
          ? vault.by_key
              .map((k) => `${k.key_id ?? "no key id"}: ${k.count}`)
              .join(" · ") || "nothing stored"
          : "disabled",
        detail: vault.by_key.some((k) => !k.current)
          ? "Some credentials are still sealed with an older key. Run npm run sync rotate-key."
          : undefined,
      },
    ];
    for (const [name, check] of Object.entries(
      (status?.watch as Watch | undefined)?.checks ?? {},
    ))
      cells.push({
        key: `watch-${name}`,
        label: name.replaceAll("_", " "),
        tone: WATCH_TONES[check.state] ?? "muted",
        title: check.value,
      });
    // A probe is the deeper answer to the same question, so where both carry
    // one name (the database) only the probe is shown: two lamps called
    // "database" in different colours read as a contradiction.
    const probed = new Set((probes.checks ?? []).map((p) => p.name));
    const kept = cells.filter((l) => !probed.has(l.label));
    for (const probe of probes.checks ?? [])
      kept.push({
        key: `probe-${probe.name}`,
        label: probe.name,
        tone: PROBE_TONES[probe.state] ?? "muted",
        title: probe.detail || undefined,
      });
    return kept;
  });

  const runtimeFacts = $derived.by((): Fact[] => {
    if (!runtime) return [];
    const turns = runtime.turns;
    return [
      {
        key: "maintenance",
        label: "new chats",
        value: runtime.refusingChats ? "paused" : "open",
        tone: runtime.refusingChats ? "warn" : "ok",
        detail: runtime.refusingChats ? "running turns finish" : undefined,
      },
      {
        key: "queue",
        label: "chat queue",
        value: String(turns.queued),
        tone: turns.queued ? "warn" : undefined,
        detail: turns.rejectedSinceBoot
          ? `${turns.rejectedSinceBoot} refused since boot`
          : "none refused",
      },
      {
        key: "approvals",
        label: "approvals waiting",
        value: String(turns.pendingApprovals),
        tone: turns.pendingApprovals ? "warn" : undefined,
        detail:
          turns.oldestApprovalAgeSeconds === null
            ? undefined
            : `oldest ${Math.round(turns.oldestApprovalAgeSeconds / 60)} min`,
      },
      {
        key: "embed",
        label: "embedding queue",
        value: runtime.embed
          ? String(runtime.embed.queries + runtime.embed.passages)
          : "–",
        detail: embedState(runtime.embed),
      },
    ];
  });

  const securityFacts = $derived.by((): Fact[] => {
    if (!runtime) return [];
    const security = runtime.security;
    return [
      {
        key: "sso",
        label: "single sign-on",
        value: security.sso_configured ? "on" : "off",
        tone: security.sso_configured ? "ok" : "muted",
        detail: security.sso_configured
          ? `${security.password_login_under_sso} with password too`
          : "password only",
      },
      {
        key: "vault",
        label: "credential vault",
        value: security.vault.enabled
          ? (security.vault.current_key ?? "on")
          : "off",
        tone: vaultTone(security.vault, "danger"),
        detail: security.vault.enabled ? undefined : "TACHY_SECRET_KEY unset",
      },
      {
        key: "passwords",
        label: "password accounts",
        value: String(security.users_with_password),
      },
      {
        key: "service",
        label: "service accounts",
        value: String(security.service_accounts),
      },
    ];
  });

  const settingFacts = $derived.by((): Fact[] => {
    if (!settings) return [];
    const src = (x: { source: string }) =>
      x.source === "default" ? undefined : x.source;
    return [
      {
        key: "model",
        label: "model",
        value: String(settings.agent_model.value),
        detail: src(settings.agent_model),
      },
      {
        key: "effort",
        label: "effort",
        value: String(settings.agent_effort.value),
        detail: src(settings.agent_effort),
      },
      {
        key: "slots",
        label: "chat slot cap",
        value: String(settings.agent_slot_cap.value),
        detail: src(settings.agent_slot_cap),
      },
      {
        key: "redaction",
        label: "PII redaction",
        value: settings.redaction_global.value ? "on" : "per connection",
        tone: settings.redaction_global.value ? "ok" : undefined,
      },
      {
        key: "profile",
        label: "profile",
        value: String(settings.deployment_profile.value),
      },
    ];
  });

  const backups = $derived.by((): Col[] => {
    const rows = ((runtime?.history?.backup ?? []) as Result[])
      .filter((b) => b.at)
      .slice(-12);
    const top = Math.max(1, ...rows.map((b) => (b.dump_bytes ?? 0) / 2 ** 20));
    return rows.map((b) =>
      b.ok === false
        ? {
            key: b.at!,
            label: dayOfMonth(b.at!),
            title: `${utcTip(b.at)} · failed: ${b.error ?? ""}`,
            value: top,
            text: "fail",
            tone: "danger",
          }
        : {
            key: b.at!,
            label: dayOfMonth(b.at!),
            title: `${utcTip(b.at)} · ${bytes(b.dump_bytes ?? 0)}`,
            value: (b.dump_bytes ?? 0) / 2 ** 20,
          },
    );
  });

  const RUN_TONES: Record<string, Col["tone"]> = {
    passed: "ok",
    failed: "danger",
    error: "danger",
  };
  const loadTests = $derived(
    loads.data.runs
      .map((run) => ({ run, p95: runP95(run) }))
      .filter((x) => x.p95 !== null)
      .slice(0, 12)
      .reverse()
      .map(({ run, p95 }): Col => ({
        key: run.id,
        label: dayOfMonth(run.created_at),
        title: `${run.script}${run.profile ? ` (${run.profile})` : ""} · ${run.target} · ${run.status} · ${utcTip(run.created_at)}`,
        value: p95 ?? 0,
        tone: RUN_TONES[run.status] ?? "muted",
      })),
  );

  const storage = $derived(
    (runtime?.tableSizes ?? []).map((x): Bar => ({
      key: x.table,
      label: x.table,
      value: x.bytes,
    })),
  );

  type Backup = Result & { at: string };
  const history = $derived(
    ((runtime?.history?.backup ?? []) as Result[]).filter((b): b is Backup =>
      Boolean(b.at),
    ),
  );
  const backupColumns: Column<Backup>[] = [
    col<Backup>("at", "taken", (b) => new Date(b.at).toLocaleString()),
    col<Backup>("age", "age", (b) => agoText(b.at), { end: true }),
    col<Backup>("ok", "result", (b) => (b.ok === false ? "failed" : "ok")),
    col<Backup>(
      "size",
      "dump",
      (b) => (b.dump_bytes ? bytes(b.dump_bytes) : "–"),
      { end: true },
    ),
    col<Backup>("error", "error", (b) => b.error ?? b.problems ?? ""),
  ];
  const backupFigures = $derived<Count[]>([
    { key: "kept", label: "backups kept", value: history.length },
    {
      key: "failed",
      label: "failed",
      value: history.filter((b) => b.ok === false).length,
      tone: history.some((b) => b.ok === false) ? "danger" : "muted",
    },
    {
      key: "last",
      label: "last good",
      text: agoText(
        [...history].reverse().find((b) => b.ok !== false)?.at ?? null,
      ),
    },
    {
      key: "size",
      label: "latest dump",
      text: bytes(history.at(-1)?.dump_bytes ?? 0),
    },
  ]);

  type LoadRun = (typeof loads.data.runs)[number];
  const loadColumns: Column<LoadRun>[] = [
    col<LoadRun>("at", "run", (t) => new Date(t.created_at).toLocaleString()),
    col<LoadRun>(
      "script",
      "script",
      (t) => `${t.script}${t.profile ? ` (${t.profile})` : ""}`,
    ),
    col<LoadRun>("target", "target", (t) => t.target),
    col<LoadRun>("status", "status", (t) => t.status),
    col<LoadRun>("p95", "p95 ms", (t) => Math.round(runP95(t) ?? 0) || "–", {
      end: true,
    }),
  ];
  const loadFigures = $derived<Count[]>([
    { key: "runs", label: "runs", value: loads.data.runs.length },
    { key: "judged", label: "judged", value: summary.judged },
    {
      key: "pass",
      label: "pass rate",
      text:
        summary.passRate === null ? "–" : pct(summary.passed, summary.judged),
    },
  ]);

  const storageTotal = $derived(storage.reduce((n, x) => n + x.value, 0));
  const storageColumns: Column<Bar>[] = [
    col<Bar>("table", "table", (x) => x.label),
    col<Bar>("size", "size", (x) => bytes(x.value), { end: true }),
    col<Bar>("share", "of total", (x) => pct(x.value, storageTotal), {
      end: true,
    }),
  ];
  const storageFigures = $derived<Count[]>([
    { key: "total", label: "tables listed", text: bytes(storageTotal) },
    { key: "count", label: "tables", value: storage.length },
    {
      key: "top",
      label: "largest",
      text: storage[0]
        ? `${storage[0].label} · ${pct(storage[0].value, storageTotal)}`
        : "–",
    },
  ]);

  async function setMaintenance(refuse: boolean) {
    pausing = true;
    error = null;
    try {
      await api.post("/system/maintenance", { refuse_chats: refuse });
      await system.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      pausing = false;
    }
  }
</script>

{#snippet open(section: string, label: string)}
  <Button
    variant="ghost"
    size="sm"
    square
    icon="next"
    title={label}
    aria-label={label}
    onclick={() => showSection(section)}
  />
{/snippet}

{#snippet runtimeExtra(fact: Fact)}
  {#if fact.key === "maintenance" && runtime}
    <Checkbox
      checked={runtime.refusingChats}
      disabled={pausing}
      ariaLabel="pause new chats"
      onchange={(on) => setMaintenance(on)}
    />
  {/if}
{/snippet}

{#snippet backupChart()}
  <Columns rows={backups} format={(n) => String(Math.round(n))} fill />
{/snippet}
{#snippet backupTable()}
  <DataTable
    columns={backupColumns}
    rows={[...history].reverse()}
    rowKey={(b) => b.at}
  />
{/snippet}
{#snippet loadChart()}
  <Columns rows={loadTests} fill />
{/snippet}
{#snippet loadTable()}
  <DataTable
    columns={loadColumns}
    rows={loads.data.runs}
    rowKey={(t) => t.id}
  />
{/snippet}
{#snippet storageChart()}
  <Bars rows={storage} format={bytes} />
{/snippet}
{#snippet storageTable()}
  <DataTable columns={storageColumns} rows={storage} rowKey={(x) => x.key} />
{/snippet}

<Overview
  {figures}
  cols={3}
  rows={3}
  loading={system.loading && !system.data}
  error={error ?? system.error ?? loads.error}
>
  <Tile title="load" meta="live" span={2} empty={!gauges.length}>
    <Dials items={gauges} />
  </Tile>

  <Tile title="checks" empty={!lamps.length}>
    {#snippet actions()}
      <Button
        variant="ghost"
        size="sm"
        square
        icon="test"
        title="run the environment checks"
        aria-label="run checks"
        busy={probes.running}
        onclick={runProbes}
      />
      {@render open("checks", "every check")}
    {/snippet}
    <Cells cells={lamps} onpick={(c) => (lamp = c)} />
  </Tile>

  <Tile title="runtime" empty={!runtimeFacts.length}>
    {#snippet actions()}{@render open(
        "runtime",
        "full runtime detail",
      )}{/snippet}
    <Facts items={runtimeFacts} extra={runtimeExtra} />
  </Tile>

  <Tile title="security" empty={!securityFacts.length}>
    {#snippet actions()}
      <!-- Another page, not a section of this one, so a navigation rather
           than showSection, which would build /admin/system/admins. -->
      <Button
        variant="ghost"
        size="sm"
        square
        icon="next"
        title="who holds app admin"
        aria-label="app admins"
        onclick={() => navigate("/admin/access/admins")}
      />
    {/snippet}
    <Facts items={securityFacts} />
  </Tile>

  <Tile title="settings" empty={!settingFacts.length}>
    {#snippet actions()}
      <Button
        variant="ghost"
        size="sm"
        square
        icon="edit"
        title="edit runtime settings"
        aria-label="edit runtime settings"
        onclick={() => showSection("settings")}
      />
    {/snippet}
    <Facts items={settingFacts} />
  </Tile>

  <Tile title="backups" key="backups" meta="MiB" empty={!backups.length}>
    {#snippet actions()}{@render open("host", "backups and host")}{/snippet}
    {#snippet detail()}
      <Detail figures={backupFigures} table={backupTable}>
        {@render backupChart()}
      </Detail>
    {/snippet}
    {@render backupChart()}
  </Tile>

  <Tile
    title="load tests"
    key="load-tests"
    meta={summary.passRate === null
      ? "p95 ms"
      : `p95 ms · ${pct(summary.passed, summary.judged)} pass`}
    empty={!loadTests.length}
  >
    {#snippet actions()}{@render open("loads", "every load test")}{/snippet}
    {#snippet detail()}
      <Detail figures={loadFigures} table={loadTable}>
        {@render loadChart()}
      </Detail>
    {/snippet}
    {@render loadChart()}
  </Tile>

  <Tile title="storage" key="storage" expand="list" empty={!storage.length}>
    {#snippet detail()}
      <Detail figures={storageFigures} table={storageTable}>
        {@render storageChart()}
      </Detail>
    {/snippet}
    {@render storageChart()}
  </Tile>
</Overview>

{#if lamp}
  {@const open = lamp}
  <Modal
    title={open.label}
    width="28rem"
    cancelLabel="close"
    onCancel={() => (lamp = null)}
  >
    <p class="state">
      <Badge tone={open.tone}>{LAMP_WORDS[open.tone]}</Badge>
      {#if open.title}<span class="dim">{open.title}</span>{/if}
    </p>
    {#if open.detail}<Note>{open.detail}</Note>{/if}
    <button
      class="link"
      onclick={() => {
        lamp = null;
        showSection("checks");
      }}>every check</button
    >
  </Modal>
{/if}

<style>
  .state {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    margin: 0 0 var(--pad-3);
  }
  .dim {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
</style>
