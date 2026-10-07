<script lang="ts">
  import { fmtDate } from "../dates.svelte";
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "./session.svelte";
  import { t } from "../terms";
  import {
    Bars,
    Cells,
    Columns,
    DataTable,
    Radar,
    compact,
    dayOfMonth,
    usd,
    type Bar,
    type Cell,
    type Col,
    type Column,
  } from "../tui";
  import { activity } from "../admin/activity.svelte";
  import { census } from "../admin/census.svelte";
  import { pct, type Count } from "../admin/overview";
  import Detail from "../admin/Detail.svelte";
  import { col, seriesStats, signed, TILE_DAYS } from "../admin/detail";
  import type { SystemInfo } from "../system/rows";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  const u = $derived(census.data.detail.users);
  const teams = $derived(census.data.counts.teams ?? 0);
  const admin = $derived(isGlobalAdmin());
  const usage = $derived(activity.data.usage);
  const tools = $derived(activity.data.tools);

  const system = createResource(
    () => api.get<SystemInfo | null>("/system"),
    null,
  );
  onMount(() => system.reload());

  const figures = $derived([
    { key: "users", label: "users", value: u.users, to: "users" },
    { key: "teams", label: t("teams"), value: teams, to: "teams" },
    {
      key: "admins",
      label: "app admins",
      value: u.admins,
      tone: u.admins ? ("accent" as const) : ("danger" as const),
      to: "admins",
    },
    {
      key: "active",
      label: "active 7 d",
      value: usage.active_7d,
    },
    {
      key: "turns",
      label: `turns ${usage.days} d`,
      text: compact(usage.turns),
    },
    {
      key: "tokens",
      label: `tokens ${usage.days} d`,
      text: compact(usage.input_tokens + usage.output_tokens),
    },
    {
      key: "cost",
      label: `cost ${usage.days} d`,
      text: usd(usage.cost_usd),
    },
    {
      key: "flow-cost",
      label: `flows ${usage.days} d`,
      text: usd(usage.flows.cost_usd),
    },
  ]);

  // userCensus counts app admins and team admins among the enabled and never
  // the same person twice, so these four are the whole roll.
  const members = $derived(
    Math.max(0, u.users - u.disabled - u.admins - u.team_admins),
  );
  const roles = $derived<Col[]>([
    { key: "admins", label: "admins", title: "app admins", value: u.admins },
    {
      key: "team-admins",
      label: "leads",
      title: `${t("team")} admins`,
      value: u.team_admins,
    },
    { key: "members", label: "members", value: members },
    { key: "disabled", label: "disabled", value: u.disabled, tone: "muted" },
  ]);

  const config = $derived.by((): Cell[] => {
    const info = system.data;
    if (!info) return [];
    const s = info.settings;
    const creds = info.credentials;
    const env = info.env;
    const out: Cell[] = [
      {
        key: "vault",
        label: "vault",
        tone: creds.vault_enabled ? "ok" : "warn",
        title: creds.vault_enabled
          ? "encrypted, keyed by TACHY_SECRET_KEY"
          : "off: TACHY_SECRET_KEY unset",
      },
      {
        key: "agent",
        label: "agent key",
        tone: creds.anthropic_api_key ? "ok" : "muted",
        title: creds.anthropic_api_key
          ? `${s.agent_model.value}, fallback key from ${creds.anthropic_api_key}`
          : "no anthropic_api_key in the environment: each user brings their own in Settings › Keys",
      },
    ];
    out.push({
      key: "password",
      label: "password sign-in",
      tone: "muted",
      title: `${u.with_password} of ${u.users} users sign in with a password (${pct(u.with_password, u.users)}), the rest through SSO`,
    });
    if (admin)
      out.push({
        key: "redaction",
        label: "PII redaction",
        tone: s.redaction_global.value ? "ok" : "muted",
        title: s.redaction_global.value
          ? "scrubbed at the MCP boundary"
          : "off",
      });
    if (env)
      out.push(
        {
          key: "session",
          label: "session secret",
          tone: env.session_secret_set ? "ok" : "warn",
          title: env.session_secret_set ? "set" : "unset",
        },
        {
          key: "token",
          label: "API token",
          tone: env.api_token_set ? "ok" : "muted",
          title: env.api_token_set ? "set" : "unset",
        },
        {
          key: "oidc",
          label: "OIDC",
          tone: env.oidc_configured ? "ok" : "muted",
          title: env.oidc_configured ? "configured" : "off",
        },
        { key: "auth", label: `auth ${env.auth_mode}`, tone: "muted" },
      );
    if (admin)
      out.push({
        key: "profile",
        label: s.deployment_profile.value,
        tone: "muted",
        title: "deployment profile",
      });
    return out;
  });

  // A failure is only news here when the agent caused it: "held it wrong" is
  // feedback on that tool's description. Both ride inside the bar of the calls
  // they are part of.
  const TOOL_KEY = [
    { key: "calls", label: "calls", tone: "accent" },
    { key: "failures", label: "failed", tone: "danger" },
    { key: "misuse", label: "misused", tone: "warn" },
  ] as const;
  const topTools = $derived(
    tools.tools.map((x): Bar => ({
      key: x.tool,
      label: x.tool,
      value: x.calls,
      inner: [
        { key: "failures", value: x.failures, tone: "danger" },
        { key: "misuse", value: x.misuse, tone: "warn" },
      ],
    })),
  );

  // A model is a category: a fixed tone per rank, and past three the tail folds
  // into "other" rather than inventing a fifth colour.
  const MODEL_TONES = ["accent", "info", "ok"] as const;
  const models = $derived([
    ...usage.by_model
      .slice(0, 3)
      .map((m, i) => ({ key: m.model, label: m.model, tone: MODEL_TONES[i] })),
    ...(usage.by_model.length > 3
      ? [{ key: "other", label: "other", tone: "muted" as const }]
      : []),
  ]);
  const tokens = $derived(
    usage.per_day.map((d): Col => {
      const by = d.models ?? {};
      const named = models.filter((m) => m.key !== "other");
      const known = named.reduce((n, m) => n + (by[m.key] ?? 0), 0);
      return {
        key: d.day,
        label: dayOfMonth(d.day),
        title: fmtDate(d.day),
        value: d.tokens,
        parts: [
          ...named.map((m) => ({
            key: m.key,
            value: by[m.key] ?? 0,
            tone: m.tone,
          })),
          {
            key: "other",
            value: Math.max(0, d.tokens - known),
            tone: "muted" as const,
          },
        ],
      };
    }),
  );
  const tileTokens = $derived(tokens.slice(-TILE_DAYS));
  const tokenTotal = $derived(tileTokens.reduce((n, d) => n + d.value, 0));

  const CALL_KINDS = [
    { key: "reads", label: "reads", tone: "accent" },
    { key: "writes", label: "writes", tone: "info" },
  ] as const;
  const calls = $derived(
    tools.per_day.map((d): Col => ({
      key: d.day,
      label: dayOfMonth(d.day),
      title: fmtDate(d.day),
      value: d.reads + d.writes,
      parts: CALL_KINDS.map((k) => ({
        key: k.key,
        value: d[k.key],
        tone: k.tone,
      })),
    })),
  );
  const tileCalls = $derived(calls.slice(-TILE_DAYS));
  const callTotal = $derived(tileCalls.reduce((n, d) => n + d.value, 0));

  const heaviest = $derived(
    (usage.top_users ?? []).map((x): Bar => ({
      key: x.email,
      label: x.email,
      value: x.tokens,
    })),
  );
  const showHeaviest = $derived(admin && usage.top_users !== undefined);

  type Tool = (typeof tools.tools)[number];
  type User = NonNullable<typeof usage.top_users>[number];
  type Day = (typeof tools.per_day)[number];
  type Role = (typeof roles)[number];

  const share = (n: number, of: number) => (of ? pct(n, of) : "–");

  const roleColumns: Column<Role>[] = [
    col<Role>("role", "role", (r) => r.title ?? r.label),
    col<Role>("users", "users", (r) => r.value, { end: true }),
    col<Role>("share", "of users", (r) => share(r.value, u.users), {
      end: true,
    }),
  ];
  const roleFigures = $derived<Count[]>([
    { key: "users", label: "users", value: u.users },
    { key: "disabled", label: "disabled", value: u.disabled, tone: "muted" },
    {
      key: "noteam",
      label: `in no ${t("team")}`,
      value: u.users_no_team,
      tone: u.users_no_team ? "warn" : "muted",
    },
    {
      key: "noadmin",
      label: `${t("teams")} without an admin`,
      value: u.teams_without_admin.length,
      tone: u.teams_without_admin.length ? "warn" : "muted",
    },
  ]);

  const toolTotal = $derived(tools.tools.reduce((n, x) => n + x.calls, 0));
  const failures = $derived(tools.tools.reduce((n, x) => n + x.failures, 0));
  const misuse = $derived(tools.tools.reduce((n, x) => n + x.misuse, 0));
  const toolColumns: Column<Tool>[] = [
    col<Tool>("tool", "tool", (x) => x.tool),
    col<Tool>("kind", "kind", (x) => (x.writes ? "write" : "read")),
    col<Tool>("calls", "calls", (x) => x.calls, { end: true }),
    col<Tool>("share", "of calls", (x) => share(x.calls, toolTotal), {
      end: true,
    }),
    col<Tool>("failed", "failed", (x) => x.failures, { end: true }),
    col<Tool>("failrate", "failure rate", (x) => share(x.failures, x.calls), {
      end: true,
    }),
    col<Tool>("misuse", "misused", (x) => x.misuse, { end: true }),
    col<Tool>("misrate", "misuse rate", (x) => share(x.misuse, x.calls), {
      end: true,
    }),
  ];
  const toolFigures = $derived<Count[]>([
    { key: "calls", label: "calls", text: compact(toolTotal) },
    { key: "tools", label: "tools used", value: tools.tools.length },
    {
      key: "writes",
      label: "writes",
      text: share(tools.writes, tools.reads + tools.writes),
    },
    {
      key: "failed",
      label: "failed",
      value: failures,
      tone: failures ? "warn" : "muted",
    },
    {
      key: "misuse",
      label: "misused",
      value: misuse,
      tone: misuse ? "warn" : "muted",
    },
  ]);

  const userColumns: Column<User>[] = [
    col<User>("user", "user", (x) => x.email),
    col<User>("turns", "turns", (x) => x.turns, { end: true }),
    col<User>("tokens", "tokens", (x) => compact(x.tokens), { end: true }),
    col<User>(
      "per",
      "tokens per turn",
      (x) => compact(x.turns ? Math.round(x.tokens / x.turns) : 0),
      { end: true },
    ),
    col<User>("cost", "cost", (x) => usd(x.cost_usd), { end: true }),
  ];
  const userFigures = $derived<Count[]>([
    { key: "active", label: "people active", value: usage.active },
    { key: "turns", label: "turns", value: usage.turns },
    {
      key: "tokens",
      label: "tokens",
      text: compact(usage.input_tokens + usage.output_tokens),
    },
    { key: "cost", label: "cost", text: usd(usage.cost_usd) },
  ]);

  const tokenStats = $derived(seriesStats(tokens));
  const tokenFigures = $derived<Count[]>([
    { key: "tokens", label: "tokens", text: compact(tokenStats.total) },
    { key: "turns", label: "turns", value: usage.turns },
    { key: "cost", label: "cost", text: usd(usage.cost_usd) },
    {
      key: "out",
      label: "output share",
      text: share(
        usage.output_tokens,
        usage.input_tokens + usage.output_tokens,
      ),
    },
    {
      key: "mean",
      label: "per day",
      text: compact(Math.round(tokenStats.mean)),
    },
    {
      key: "change",
      label: "vs earlier half",
      text: signed(tokenStats.change),
    },
  ]);
  const tokenColumns = $derived<Column<Col>[]>([
    col<Col>("day", "day", (d) => d.title ?? d.label),
    col<Col>("total", "tokens", (d) => compact(d.value), { end: true }),
    ...models.map((m) =>
      col<Col>(
        m.key,
        m.label,
        (d) => compact(d.parts?.find((p) => p.key === m.key)?.value ?? 0),
        { end: true },
      ),
    ),
  ]);

  const callStats = $derived(seriesStats(calls));
  const callColumns: Column<Day>[] = [
    col<Day>("day", "day", (d) => fmtDate(d.day)),
    col<Day>("reads", "reads", (d) => d.reads, { end: true }),
    col<Day>("writes", "writes", (d) => d.writes, { end: true }),
    col<Day>("total", "calls", (d) => d.reads + d.writes, { end: true }),
    col<Day>(
      "share",
      "write share",
      (d) => share(d.writes, d.reads + d.writes),
      { end: true },
    ),
  ];
  const callFigures = $derived<Count[]>([
    { key: "calls", label: "calls", text: compact(callStats.total) },
    { key: "reads", label: "reads", text: compact(tools.reads) },
    { key: "writes", label: "writes", text: compact(tools.writes) },
    {
      key: "mean",
      label: "per day",
      text: compact(Math.round(callStats.mean)),
    },
    {
      key: "peak",
      label: "busiest day",
      text: callStats.peak
        ? `${callStats.peak.label} · ${compact(callStats.peak.value)}`
        : "–",
    },
    { key: "change", label: "vs earlier half", text: signed(callStats.change) },
  ]);
</script>

{#snippet rolesChart()}
  <Radar
    axes={roles.map((x) => ({ key: x.key, label: x.label, tone: x.tone }))}
    series={[
      {
        key: "users",
        label: "users",
        tone: "accent",
        values: roles.map((x) => x.value),
      },
    ]}
  />
{/snippet}
{#snippet rolesTable()}
  <DataTable columns={roleColumns} rows={roles} rowKey={(r) => r.key} />
{/snippet}
{#snippet toolsChart()}
  <Bars rows={topTools} format={compact} legend={[...TOOL_KEY]} />
{/snippet}
{#snippet toolsTable()}
  <DataTable columns={toolColumns} rows={tools.tools} rowKey={(x) => x.tool} />
{/snippet}
{#snippet usersChart()}
  <Bars rows={heaviest} format={compact} />
{/snippet}
{#snippet usersTable()}
  <DataTable
    columns={userColumns}
    rows={usage.top_users ?? []}
    rowKey={(x) => x.email}
  />
{/snippet}
{#snippet tokensChart(rows: Col[])}
  <Columns {rows} format={compact} legend={models} fill />
{/snippet}
{#snippet tokensTable()}
  <DataTable
    columns={tokenColumns}
    rows={[...tokens].reverse()}
    rowKey={(d) => d.key}
  />
{/snippet}
{#snippet callsChart(rows: Col[])}
  <Columns {rows} format={compact} legend={[...CALL_KINDS]} fill />
{/snippet}
{#snippet callsTable()}
  <DataTable
    columns={callColumns}
    rows={[...tools.per_day].reverse()}
    rowKey={(d) => d.day}
  />
{/snippet}

<Overview
  {figures}
  cols={4}
  loading={census.loading}
  error={census.error ?? activity.error ?? system.error}
>
  <Tile title="config" empty={!config.length}>
    <Cells cells={config} />
  </Tile>

  <Tile
    title="roles"
    key="roles"
    meta={`${u.users}`}
    span={showHeaviest ? 1 : 2}
    empty={!u.users}
  >
    {#snippet detail()}
      <Detail figures={roleFigures} loading={census.loading} table={rolesTable}>
        {@render rolesChart()}
      </Detail>
    {/snippet}
    {@render rolesChart()}
  </Tile>

  <Tile
    title="top tools"
    key="top-tools"
    expand="list"
    meta="{tools.days} d"
    empty={!topTools.length}
  >
    {#snippet detail()}
      <Detail
        figures={toolFigures}
        windowed
        days={tools.days}
        loading={activity.loading}
        table={toolsTable}
      >
        {@render toolsChart()}
      </Detail>
    {/snippet}
    {@render toolsChart()}
  </Tile>

  {#if showHeaviest}
    <Tile
      title="top users"
      key="top-users"
      expand="list"
      meta="{usage.days} d"
      empty={!heaviest.length}
    >
      {#snippet detail()}
        <Detail
          figures={userFigures}
          windowed
          days={usage.days}
          loading={activity.loading}
          table={usersTable}
        >
          {@render usersChart()}
        </Detail>
      {/snippet}
      {@render usersChart()}
    </Tile>
  {/if}

  <Tile
    title="tokens"
    key="tokens"
    meta={`${compact(tokenTotal)} · ${tileTokens.length} d`}
    span={2}
    empty={!tokenTotal}
  >
    {#snippet detail()}
      <Detail
        figures={tokenFigures}
        windowed
        days={usage.days}
        loading={activity.loading}
        table={tokensTable}
      >
        {@render tokensChart(tokens)}
      </Detail>
    {/snippet}
    {@render tokensChart(tileTokens)}
  </Tile>

  <Tile
    title="tool calls"
    key="tool-calls"
    meta={`${compact(callTotal)} · ${tileCalls.length} d`}
    span={2}
    empty={!callTotal}
  >
    {#snippet detail()}
      <Detail
        figures={callFigures}
        windowed
        days={tools.days}
        loading={activity.loading}
        table={callsTable}
      >
        {@render callsChart(calls)}
      </Detail>
    {/snippet}
    {@render callsChart(tileCalls)}
  </Tile>
</Overview>
