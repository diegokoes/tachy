<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { Bars, Cells, Columns, dayOfMonth, type Bar, type Cell, type Col } from "../tui";
  import { runP95, type TestRun } from "./loadRuns";
  import { age, bytes, load, pct, ratio, span, type Tone } from "./overview";
  import type { SystemInfo } from "./rows";
  import Dials, { type DialItem } from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  type Result = { ok?: boolean; at?: string; error?: string; problems?: string; dump_bytes?: number };
  type Watch = { checks?: Record<string, { state: string; value: string }> };
  type Host = { disk?: Record<string, string> };

  const HOUR = 3_600_000;

  let now = $state(Date.now());
  const system = createResource(async () => {
    const got = await api.get<SystemInfo>("/system");
    now = Date.now();
    return got;
  }, null as SystemInfo | null);
  const tests = createResource(
    async () => (await api.get<{ runs: TestRun[] }>("/tests/runs")).runs,
    [] as TestRun[],
  );

  /* Current values only; a light refresh keeps them honest while the page is open. */
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void system.reload();
    void tests.reload();
    timer = setInterval(() => void system.reload(), 10_000);
  });
  onDestroy(() => timer && clearInterval(timer));

  const r = $derived(system.data?.runtime ?? null);
  const status = $derived((r?.status ?? null) as Record<string, unknown> | null);
  const backup = $derived(status?.backup as Result | undefined);
  const restore = $derived(status?.restore as Result | undefined);

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
    return [
      { key: "status", label: "status", ...state, to: "runtime" },
      {
        key: "release",
        label: "release",
        text: commit ? commit.slice(0, 7) : "dev",
        tone: commit ? ("accent" as Tone) : ("muted" as Tone),
        title: system.data?.env?.env_badge ?? undefined,
      },
      { key: "up", label: "up", text: r?.uptimeSeconds !== undefined ? span(r.uptimeSeconds * 1000) : "–" },
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

  const WATCH_TONES: Record<string, Cell["tone"]> = { ok: "ok", warn: "warn", fail: "danger" };
  const checks = $derived.by((): Cell[] => {
    if (!r) return [];
    const rd = r.readiness;
    const vault = r.security.vault;
    const out: Cell[] = [
      { key: "database", label: "database", tone: rd.database ? "ok" : "danger", title: rd.database ? "up" : "down" },
      {
        key: "schema",
        label: "schema",
        tone: rd.schema === "match" ? "ok" : rd.schema === "mismatch" ? "danger" : rd.schema === "unstamped" ? "muted" : "warn",
        title: rd.schema,
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
        title: vault.enabled ? vault.by_key.map((k) => `${k.key_id ?? "no key id"}: ${k.count}`).join(" · ") || "nothing stored" : "disabled",
      },
      {
        key: "sso",
        label: "SSO",
        tone: r.security.sso_configured ? "ok" : "muted",
        title: r.security.sso_configured ? "configured" : "password only",
      },
    ];
    for (const [name, c] of Object.entries((status?.watch as Watch | undefined)?.checks ?? {}))
      out.push({
        key: `watch-${name}`,
        label: name.replaceAll("_", " "),
        tone: WATCH_TONES[c.state] ?? "muted",
        title: c.value,
      });
    return out;
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
    tests.data
      .map((t) => ({ t, p95: runP95(t) }))
      .filter((x) => x.p95 !== null)
      .slice(0, 12)
      .reverse()
      .map(
        ({ t, p95 }): Col => ({
          key: t.id,
          label: dayOfMonth(t.created_at),
          title: `${t.script} · ${t.target} · ${t.status} · ${new Date(t.created_at).toLocaleString()}`,
          value: p95 ?? 0,
          tone: t.status === "passed" ? "ok" : t.status === "failed" || t.status === "error" ? "danger" : "muted",
        }),
      ),
  );

  const storage = $derived(
    (r?.tableSizes ?? []).map((x): Bar => ({ key: x.table, label: x.table, value: x.bytes })),
  );
</script>

<Overview {figures} loading={system.loading && !system.data} error={system.error ?? tests.error}>
  <Tile title="load" meta="live" span={2} empty={!gauges.length}>
    <Dials items={gauges} />
  </Tile>

  <Tile title="checks" empty={!checks.length}>
    <Cells cells={checks} />
  </Tile>

  <Tile title="backups" meta="MiB" empty={!backups.length}>
    <Columns rows={backups} format={(n) => String(Math.round(n))} fill />
  </Tile>

  <Tile title="load tests" meta="p95 ms" empty={!loadTests.length}>
    <Columns rows={loadTests} fill />
  </Tile>

  <Tile title="storage" empty={!storage.length}>
    <Bars rows={storage} format={bytes} fit />
  </Tile>
</Overview>
