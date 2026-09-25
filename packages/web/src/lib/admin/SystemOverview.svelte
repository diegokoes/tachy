<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { navigate } from "../router.svelte";
  import { errText } from "../resource.svelte";
  import {
    Badge,
    Bars,
    Button,
    Cells,
    Checkbox,
    Columns,
    Modal,
    Note,
    dayOfMonth,
    type Bar,
    type Cell,
    type Col,
  } from "../tui";
  import { loadSummary, runP95 } from "./loadRuns";
  import { age, bytes, load, pct, ratio, showSection, span, type Tone } from "./overview";
  import Dials, { type DialItem } from "./Dials.svelte";
  import Facts, { type Fact } from "./Facts.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";
  import { census } from "./census.svelte";
  import { loads, probes, probeTally, runProbes, system } from "./systemState.svelte";

  type Result = { ok?: boolean; at?: string; error?: string; problems?: string; dump_bytes?: number };
  type Watch = { checks?: Record<string, { state: string; value: string }> };
  type Host = { disk?: Record<string, string> };

  const HOUR = 3_600_000;

  let now = $state(Date.now());
  let error = $state<string | null>(null);
  let pausing = $state(false);
  /** The lamp whose detail is open, if one is. */
  let lamp = $state<(Cell & { detail?: string }) | null>(null);

  /* Current values only; a light refresh keeps them honest while the page is
     open. The probes are deliberately not on this clock; see systemState. */
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

  const r = $derived(system.data?.runtime ?? null);
  const settings = $derived(system.data?.settings ?? null);
  const status = $derived((r?.status ?? null) as Record<string, unknown> | null);
  const backup = $derived(status?.backup as Result | undefined);
  const restore = $derived(status?.restore as Result | undefined);
  const tally = $derived(probeTally(probes.checks));
  const summary = $derived(loadSummary(loads.data.runs));

  /** A host result as a counter: its age, toned by whether it failed or is overdue. */
  const result = (x: Result | undefined, overdue: number): { text: string; tone: Tone; title?: string } => {
    if (!status) return { text: "–", tone: "muted", title: "TACHY_STATUS_DIR not mounted" };
    if (!x?.at) return { text: "none", tone: "danger" };
    const text = age(x.at, now) ?? "–";
    if (x.ok === false) return { text, tone: "danger", title: x.error ?? x.problems };
    return { text, tone: now - Date.parse(x.at) > overdue ? "warn" : "ok", title: x.at };
  };

  const disk = $derived.by(() => {
    const used = Object.values((status?.host as Host | undefined)?.disk ?? {})
      .map((v) => parseInt(v, 10))
      .filter(Number.isFinite);
    return used.length ? Math.max(...used) : null;
  });

  const figures = $derived.by(() => {
    const ready = r?.readiness.ready;
    const state = !r
      ? { text: "–", tone: "muted" as Tone }
      : r.draining
        ? { text: "draining", tone: "warn" as Tone }
        : !ready
          ? { text: "not ready", tone: "danger" as Tone }
          : r.refusingChats
            ? { text: "paused", tone: "warn" as Tone }
            : { text: "ready", tone: "ok" as Tone };
    const commit = system.data?.env?.commit;
    const b = result(backup, 12 * HOUR);
    const rt = result(restore, 8 * 24 * HOUR);
    /* A skipped probe ran nothing, so it is out of the denominator too. */
    const counted = tally ? tally.total - tally.skipped : 0;
    const openReports = census.data.warn.reports ?? 0;
    return [
      { key: "status", label: "status", ...state, to: "runtime" },
      {
        key: "reports",
        label: "reports",
        value: census.data.counts.reports ?? 0,
        tone: openReports
          ? ("warn" as Tone)
          : census.data.counts.reports
            ? ("accent" as Tone)
            : ("muted" as Tone),
        title: openReports
          ? `${openReports} open`
          : "user bug reports & feature requests",
        to: "reports",
      },
      {
        key: "release",
        label: "release",
        text: commit ? commit.slice(0, 7) : "dev",
        tone: commit ? ("accent" as Tone) : ("muted" as Tone),
        title: system.data?.env?.env_badge ?? undefined,
      },
      { key: "up", label: "up", text: r?.uptimeSeconds !== undefined ? span(r.uptimeSeconds * 1000) : "–" },
      {
        key: "checks",
        label: "checks",
        text: probes.running && !tally ? "…" : tally ? `${tally.passing}/${counted}` : "–",
        tone: !tally
          ? ("muted" as Tone)
          : tally.failing
            ? ("danger" as Tone)
            : tally.warning
              ? ("warn" as Tone)
              : ("ok" as Tone),
        title: tally
          ? `${tally.passing} passing · ${tally.warning} warning · ${tally.failing} failing · ${tally.skipped} skipped`
          : "not run yet",
        to: "checks",
      },
      {
        key: "loads",
        label: "load tests",
        text: summary.passRate === null ? "–" : pct(summary.passed, summary.judged),
        tone:
          summary.passRate === null
            ? ("muted" as Tone)
            : summary.passRate >= 0.95
              ? ("ok" as Tone)
              : summary.passRate >= 0.8
                ? ("warn" as Tone)
                : ("danger" as Tone),
        title: `${summary.passed} of ${summary.judged} finished runs passed`,
        to: "loads",
      },
      { key: "backup", label: "last backup", ...b, to: "host" },
      { key: "restore", label: "restore test", ...rt, to: "host" },
      {
        key: "disk",
        label: "disk",
        text: disk === null ? "–" : `${disk}%`,
        tone: disk === null ? ("muted" as Tone) : load(disk / 100),
        title: "fullest mount",
        to: "host",
      },
    ];
  });

  const gauges = $derived.by((): DialItem[] => {
    if (!r) return [];
    const t = r.turns;
    const pg = "error" in r.postgres ? null : r.postgres;
    const pgUsed = pg ? pg.byProcess.reduce((n, p) => n + p.n, 0) : 0;
    const mem = r.memory;
    const memShare = mem?.maxBytes ? mem.currentBytes / mem.maxBytes : null;
    const loop = r.eventLoopP99Ms;
    return [
      {
        key: "slots",
        label: "chat slots",
        title: `${t.queued} queued · ${t.rejectedSinceBoot} refused since boot`,
        value: ratio(t.slotsUsed, t.slotCap),
        tone: load(ratio(t.slotsUsed, t.slotCap)),
        center: pct(t.slotsUsed, t.slotCap),
        sub: `${t.slotsUsed}/${t.slotCap}`,
      },
      {
        key: "memory",
        label: "memory",
        title: memShare === null ? "no container limit" : "of the container limit",
        value: memShare ?? 0,
        tone: memShare === null ? "muted" : load(memShare),
        center: memShare === null ? (mem ? bytes(mem.currentBytes) : "–") : `${Math.round(memShare * 100)}%`,
        sub: mem ? (mem.maxBytes ? `${bytes(mem.currentBytes)}` : "no limit") : "unknown",
      },
      {
        key: "postgres",
        label: "postgres",
        title: pg ? pg.byProcess.map((p) => `${p.name} ${p.state} ${p.n}`).join(" · ") : "unavailable",
        value: pg ? ratio(pgUsed, pg.max) : 0,
        tone: pg ? load(ratio(pgUsed, pg.max)) : "muted",
        center: pg ? pct(pgUsed, pg.max) : "–",
        sub: pg ? `${pgUsed}/${pg.max}` : "unknown",
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
  const WATCH_TONES: Record<string, Cell["tone"]> = { ok: "ok", warn: "warn", fail: "danger" };
  const PROBE_TONES: Record<string, Cell["tone"]> = { pass: "ok", warn: "warn", fail: "danger", skip: "muted" };

  /* One board for every "is this working" answer: the runtime's own readiness
     lamps, tachy-watch's host checks, and the on-demand probes once run. They
     answer the same question from different distances. */
  const lamps = $derived.by((): (Cell & { detail?: string })[] => {
    if (!r) return [];
    const rd = r.readiness;
    const vault = r.security.vault;
    const out: (Cell & { detail?: string })[] = [
      { key: "database", label: "database", tone: rd.database ? "ok" : "danger", title: rd.database ? "up" : "down" },
      {
        key: "schema",
        label: "schema",
        tone: rd.schema === "match" ? "ok" : rd.schema === "mismatch" ? "danger" : rd.schema === "unstamped" ? "muted" : "warn",
        title: rd.schema,
        detail:
          rd.schema === "mismatch"
            ? "The database schema does not match what this build expects. Apply db/schema.sql before relying on anything new."
            : undefined,
      },
      {
        key: "model",
        label: "model",
        tone:
          rd.model === "ready" || rd.model === "external"
            ? "ok"
            : rd.model === "unreachable"
              ? "danger"
              : rd.model === "loading"
                ? "warn"
                : "muted",
        title: rd.model,
      },
      {
        key: "vault",
        label: "vault keys",
        tone: !vault.enabled ? "muted" : vault.by_key.some((k) => !k.current) ? "warn" : "ok",
        title: vault.enabled
          ? vault.by_key.map((k) => `${k.key_id ?? "no key id"}: ${k.count}`).join(" · ") || "nothing stored"
          : "disabled",
        detail: vault.by_key.some((k) => !k.current)
          ? "Some credentials are still sealed with an older key. Run npm run sync rotate-key."
          : undefined,
      },
    ];
    for (const [name, c] of Object.entries((status?.watch as Watch | undefined)?.checks ?? {}))
      out.push({
        key: `watch-${name}`,
        label: name.replaceAll("_", " "),
        tone: WATCH_TONES[c.state] ?? "muted",
        title: c.value,
      });
    /* A probe is the deeper answer to the same question, so where both carry
       one name (the database), only the probe is shown. Two lamps called
       "database", one green and one red, read as the board contradicting
       itself. */
    const probed = new Set((probes.checks ?? []).map((p) => p.name));
    const kept = out.filter((l) => !probed.has(l.label));
    for (const p of probes.checks ?? [])
      kept.push({
        key: `probe-${p.name}`,
        label: p.name,
        tone: PROBE_TONES[p.state] ?? "muted",
        title: p.detail || undefined,
      });
    return kept;
  });

  const runtimeFacts = $derived.by((): Fact[] => {
    if (!r) return [];
    const t = r.turns;
    return [
      {
        key: "maintenance",
        label: "new chats",
        value: r.refusingChats ? "paused" : "open",
        tone: r.refusingChats ? "warn" : "ok",
        detail: r.refusingChats ? "running turns finish" : undefined,
      },
      {
        key: "queue",
        label: "chat queue",
        value: String(t.queued),
        tone: t.queued ? "warn" : undefined,
        detail: t.rejectedSinceBoot ? `${t.rejectedSinceBoot} refused since boot` : "none refused",
      },
      {
        key: "approvals",
        label: "approvals waiting",
        value: String(t.pendingApprovals),
        tone: t.pendingApprovals ? "warn" : undefined,
        detail:
          t.oldestApprovalAgeSeconds === null
            ? undefined
            : `oldest ${Math.round(t.oldestApprovalAgeSeconds / 60)} min`,
      },
      {
        key: "embed",
        label: "embedding queue",
        value: r.embed ? String(r.embed.queries + r.embed.passages) : "–",
        detail: r.embed ? (r.embed.running ? "busy" : "idle") : "unknown",
      },
    ];
  });

  const securityFacts = $derived.by((): Fact[] => {
    if (!r) return [];
    const s = r.security;
    return [
      {
        key: "sso",
        label: "single sign-on",
        value: s.sso_configured ? "on" : "off",
        tone: s.sso_configured ? "ok" : "muted",
        detail: s.sso_configured ? `${s.password_login_under_sso} with password too` : "password only",
      },
      {
        key: "vault",
        label: "credential vault",
        value: s.vault.enabled ? (s.vault.current_key ?? "on") : "off",
        tone: !s.vault.enabled ? "danger" : s.vault.by_key.some((k) => !k.current) ? "warn" : "ok",
        detail: s.vault.enabled ? undefined : "TACHY_SECRET_KEY unset",
      },
      { key: "passwords", label: "password accounts", value: String(s.users_with_password) },
      { key: "service", label: "service accounts", value: String(s.service_accounts) },
    ];
  });

  const settingFacts = $derived.by((): Fact[] => {
    if (!settings) return [];
    const src = (x: { source: string }) => (x.source === "default" ? undefined : x.source);
    return [
      { key: "provider", label: "agent", value: String(settings.agent_provider.value), detail: src(settings.agent_provider) },
      { key: "model", label: "model", value: String(settings.agent_model.value), detail: src(settings.agent_model) },
      { key: "effort", label: "effort", value: String(settings.agent_effort.value), detail: src(settings.agent_effort) },
      { key: "slots", label: "chat slot cap", value: String(settings.agent_slot_cap.value), detail: src(settings.agent_slot_cap) },
      {
        key: "redaction",
        label: "PII redaction",
        value: settings.redaction_global.value ? "on" : "per connection",
        tone: settings.redaction_global.value ? "ok" : undefined,
      },
      { key: "profile", label: "profile", value: String(settings.deployment_profile.value) },
    ];
  });

  const backups = $derived.by((): Col[] => {
    const rows = ((r?.history?.backup ?? []) as Result[]).filter((b) => b.at).slice(-12);
    const top = Math.max(1, ...rows.map((b) => (b.dump_bytes ?? 0) / 2 ** 20));
    return rows.map((b) =>
      b.ok === false
        ? {
            key: b.at!,
            label: dayOfMonth(b.at!),
            title: `${b.at} · failed: ${b.error ?? ""}`,
            value: top,
            text: "fail",
            tone: "danger",
          }
        : {
            key: b.at!,
            label: dayOfMonth(b.at!),
            title: `${b.at} · ${bytes(b.dump_bytes ?? 0)}`,
            value: (b.dump_bytes ?? 0) / 2 ** 20,
          },
    );
  });

  const loadTests = $derived(
    loads.data.runs
      .map((t) => ({ t, p95: runP95(t) }))
      .filter((x) => x.p95 !== null)
      .slice(0, 12)
      .reverse()
      .map(
        ({ t, p95 }): Col => ({
          key: t.id,
          label: dayOfMonth(t.created_at),
          title: `${t.script}${t.profile ? ` (${t.profile})` : ""} · ${t.target} · ${t.status} · ${new Date(t.created_at).toLocaleString()}`,
          value: p95 ?? 0,
          tone: t.status === "passed" ? "ok" : t.status === "failed" || t.status === "error" ? "danger" : "muted",
        }),
      ),
  );

  const storage = $derived(
    (r?.tableSizes ?? []).map((x): Bar => ({ key: x.table, label: x.table, value: x.bytes })),
  );

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
    icon="go"
    title={label}
    aria-label={label}
    onclick={() => showSection(section)}
  />
{/snippet}

{#snippet runtimeExtra(f: Fact)}
  {#if f.key === "maintenance" && r}
    <Checkbox
      checked={r.refusingChats}
      disabled={pausing}
      ariaLabel="pause new chats"
      onchange={(on) => setMaintenance(on)}
    />
  {/if}
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
    {#snippet actions()}{@render open("runtime", "full runtime detail")}{/snippet}
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
        icon="go"
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

  <Tile title="backups" meta="MiB" empty={!backups.length}>
    {#snippet actions()}{@render open("host", "backups and host")}{/snippet}
    <Columns rows={backups} format={(n) => String(Math.round(n))} fill />
  </Tile>

  <Tile
    title="load tests"
    meta={summary.passRate === null ? "p95 ms" : `p95 ms · ${pct(summary.passed, summary.judged)} pass`}
    empty={!loadTests.length}
  >
    {#snippet actions()}{@render open("loads", "every load test")}{/snippet}
    <Columns rows={loadTests} fill />
  </Tile>

  <Tile title="storage" empty={!storage.length}>
    <Bars rows={storage} format={bytes} fit />
  </Tile>
</Overview>

{#if lamp}
  {@const l = lamp}
  <Modal title={l.label} width="28rem" cancelLabel="close" onCancel={() => (lamp = null)}>
    <p class="state">
      <Badge tone={l.tone}>{LAMP_WORDS[l.tone]}</Badge>
      {#if l.title}<span class="dim">{l.title}</span>{/if}
    </p>
    {#if l.detail}<Note>{l.detail}</Note>{/if}
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
