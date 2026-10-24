<script lang="ts">
  import { fmtDate } from "../dates.svelte";
  import { isGlobalAdmin } from "../access/session.svelte";
  import {
    EMPTY,
    Bars,
    Columns,
    DataTable,
    compact,
    dayOfMonth,
    usd,
    type Bar,
    type Col,
    type Column,
  } from "../tui";
  import { activity } from "../admin/activity.svelte";
  import { pct, type Count } from "../admin/overview";
  import Detail from "../admin/Detail.svelte";
  import { col, seriesStats, signed, TILE_DAYS } from "../admin/detail";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  const admin = $derived(isGlobalAdmin());
  const usage = $derived(activity.data.usage);
  const tools = $derived(activity.data.tools);

  const figures = $derived([
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
      key: "cached",
      label: `cached ${usage.days} d`,
      text: compact(usage.cached_tokens),
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
      .slice(0, MODEL_TONES.length)
      .map((m, i) => ({ key: m.model, label: m.model, tone: MODEL_TONES[i] })),
    ...(usage.by_model.length > MODEL_TONES.length
      ? [{ key: "other", label: "other", tone: "muted" as const }]
      : []),
  ]);
  const tokens = $derived(
    usage.per_day.map((day): Col => {
      const by = day.models ?? {};
      const named = models.filter((m) => m.key !== "other");
      const known = named.reduce((n, m) => n + (by[m.key] ?? 0), 0);
      return {
        key: day.day,
        label: dayOfMonth(day.day),
        title: fmtDate(day.day),
        value: day.tokens,
        parts: [
          ...named.map((m) => ({
            key: m.key,
            value: by[m.key] ?? 0,
            tone: m.tone,
          })),
          {
            key: "other",
            value: Math.max(0, day.tokens - known),
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

  const share = (n: number, of: number) => (of ? pct(n, of) : EMPTY);

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
    { key: "cached", label: "cached", text: compact(usage.cached_tokens) },
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
        : EMPTY,
    },
    { key: "change", label: "vs earlier half", text: signed(callStats.change) },
  ]);
</script>

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

<Overview {figures} cols={4} loading={activity.loading} error={activity.error}>
  <Tile
    title="top tools"
    key="top-tools"
    expand="list"
    meta="{tools.days} d"
    span={2}
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
      span={2}
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
    span={showHeaviest ? 2 : 4}
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
