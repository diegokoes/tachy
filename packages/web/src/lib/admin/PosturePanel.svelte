<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import {
    Bars,
    Cells,
    Columns,
    compact,
    dayOfMonth,
    usd,
    type Bar,
    type Cell,
    type Col,
  } from "../tui";
  import { activity } from "./activity.svelte";
  import { census } from "./census.svelte";
  import { grade, pct, ratio } from "./overview";
  import type { SystemInfo } from "./rows";
  import Dials from "./Dials.svelte";
  import Overview from "./Overview.svelte";
  import Tile from "./Tile.svelte";

  const u = $derived(census.data.detail.users);
  const teams = $derived(census.data.counts.teams ?? 0);
  const admin = $derived(isGlobalAdmin());
  const usage = $derived(activity.data.usage);
  const tools = $derived(activity.data.tools);

  const system = createResource(() => api.get<SystemInfo | null>("/system"), null);
  onMount(() => system.reload());

  const figures = $derived([
    { key: "users", label: "users", value: u.users, to: "users" },
    { key: "teams", label: t("teams"), value: teams },
    {
      key: "admins",
      label: "app admins",
      value: u.admins,
      tone: u.admins ? ("accent" as const) : ("danger" as const),
      to: "users",
    },
    { key: "active", label: "active 7 d", value: usage.active_7d, title: "people with an agent turn in the last 7 days" },
    { key: "turns", label: `turns ${usage.days} d`, text: compact(usage.turns), title: `agent turns, last ${usage.days} days` },
    {
      key: "tokens",
      label: `tokens ${usage.days} d`,
      text: compact(usage.input_tokens + usage.output_tokens),
      title: `${compact(usage.input_tokens)} in · ${compact(usage.output_tokens)} out`,
    },
    { key: "cost", label: `cost ${usage.days} d`, text: usd(usage.cost_usd), title: "estimated at list price where the provider reported none" },
  ]);

  const inTeam = $derived(Math.max(0, u.users - u.users_no_team));
  const coverage = $derived([
    {
      key: "team-admins",
      label: `${t("teams")}`,
      title: `${t("teams")} with an admin`,
      value: ratio(u.teams_with_admin, teams),
      tone: grade(u.teams_with_admin, teams),
      center: pct(u.teams_with_admin, teams),
      sub: `${u.teams_with_admin}/${teams}`,
    },
    {
      key: "password",
      label: "password",
      title: "users who sign in with a password, against SSO",
      value: ratio(u.with_password, u.users),
      tone: "ok" as const,
      rest: "info" as const,
      center: pct(u.with_password, u.users),
      sub: `${u.with_password}/${u.users}`,
    },
    {
      key: "in-team",
      label: `in a ${t("team")}`,
      title: `users in at least one ${t("team")}`,
      value: ratio(inTeam, u.users),
      tone: grade(inTeam, u.users),
      center: pct(inTeam, u.users),
      sub: `${inTeam}/${u.users}`,
    },
  ]);

  /* userCensus counts app admins and team admins among the enabled and never
     the same person twice, so these four are the whole roll. */
  const members = $derived(Math.max(0, u.users - u.disabled - u.admins - u.team_admins));
  const roles = $derived<Col[]>([
    { key: "admins", label: "admins", title: "app admins", value: u.admins },
    { key: "team-admins", label: `${t("team")} admins`, value: u.team_admins },
    { key: "members", label: "members", value: members },
    { key: "disabled", label: "disabled", value: u.disabled, tone: "muted" },
  ]);

  const config = $derived.by((): Cell[] => {
    const info = system.data;
    if (!info) return [];
    const s = info.settings;
    const creds = info.credentials;
    const env = info.env;
    const key = s.agent_provider.value === "copilot" ? "copilot_token" : "anthropic_api_key";
    const out: Cell[] = [
      {
        key: "vault",
        label: "vault",
        tone: creds.vault_enabled ? "ok" : "warn",
        title: creds.vault_enabled ? "encrypted, keyed by TACHY_SECRET_KEY" : "off: TACHY_SECRET_KEY unset",
      },
      {
        key: "agent",
        label: "agent key",
        tone: creds[key] ? "ok" : "danger",
        title: creds[key]
          ? `${s.agent_provider.value} · ${s.agent_model.value}, key from ${creds[key]}`
          : `no ${key}: the agent cannot run`,
      },
    ];
    if (admin)
      out.push({
        key: "redaction",
        label: "PII redaction",
        tone: s.redaction_global.value ? "ok" : "muted",
        title: s.redaction_global.value ? "scrubbed at the MCP boundary" : "off",
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
      out.push({ key: "profile", label: s.deployment_profile.value, tone: "muted", title: "deployment profile" });
    return out;
  });

  /* A failure is only news here when the agent caused it: "held it wrong" is
     feedback on that tool's description. */
  const topTools = $derived(
    tools.tools.map(
      (x): Bar => ({ key: x.tool, label: x.tool, value: x.calls, tone: x.misuse ? "warn" : undefined }),
    ),
  );

  /* A model is a category: a fixed tone per rank, and past three the tail
     folds into "other" rather than inventing a fifth colour. */
  const MODEL_TONES = ["accent", "info", "ok"] as const;
  const models = $derived([
    ...usage.by_model.slice(0, 3).map((m, i) => ({ key: m.model, label: m.model, tone: MODEL_TONES[i] })),
    ...(usage.by_model.length > 3 ? [{ key: "other", label: "other", tone: "muted" as const }] : []),
  ]);
  const tokens = $derived(
    usage.per_day.map((d): Col => {
      const by = d.models ?? {};
      const named = models.filter((m) => m.key !== "other");
      const known = named.reduce((n, m) => n + (by[m.key] ?? 0), 0);
      return {
        key: d.day,
        label: dayOfMonth(d.day),
        title: d.day,
        value: d.tokens,
        parts: [
          ...named.map((m) => ({ key: m.key, value: by[m.key] ?? 0, tone: m.tone })),
          { key: "other", value: Math.max(0, d.tokens - known), tone: "muted" as const },
        ],
      };
    }),
  );
  const tokenTotal = $derived(tokens.reduce((n, d) => n + d.value, 0));

  const CALL_KINDS = [
    { key: "reads", label: "reads", tone: "accent" },
    { key: "writes", label: "writes", tone: "info" },
  ] as const;
  const calls = $derived(
    tools.per_day.map(
      (d): Col => ({
        key: d.day,
        label: dayOfMonth(d.day),
        title: d.day,
        value: d.reads + d.writes,
        parts: CALL_KINDS.map((k) => ({ key: k.key, value: d[k.key], tone: k.tone })),
      }),
    ),
  );
  const callTotal = $derived(calls.reduce((n, d) => n + d.value, 0));

  const heaviest = $derived(
    (usage.top_users ?? []).map((x): Bar => ({ key: x.email, label: x.email, value: x.tokens })),
  );
  const showHeaviest = $derived(admin && usage.top_users !== undefined);
</script>

<Overview
  {figures}
  cols={4}
  loading={census.loading}
  error={census.error ?? activity.error ?? system.error}
>
  <Tile title="coverage">
    <Dials items={coverage} />
  </Tile>

  <Tile title="roles" meta={`${u.users}`} empty={!u.users}>
    <Columns rows={roles} fill />
  </Tile>

  <Tile title="config" empty={!config.length}>
    <Cells cells={config} />
  </Tile>

  <Tile title="top tools" meta="{tools.days} d" empty={!topTools.length}>
    <Bars rows={topTools} format={compact} fit />
  </Tile>

  <Tile title="tokens" meta={`${compact(tokenTotal)} · ${tokens.length} d`} span={2} empty={!tokenTotal}>
    <Columns rows={tokens} format={compact} legend={models} fill />
  </Tile>

  <Tile title="tool calls" meta={`${compact(callTotal)} · ${calls.length} d`} span={showHeaviest ? 1 : 2} empty={!callTotal}>
    <Columns rows={calls} format={compact} legend={[...CALL_KINDS]} fill />
  </Tile>

  {#if showHeaviest}
    <Tile title="top users" meta="{usage.days} d" empty={!heaviest.length}>
      <Bars rows={heaviest} format={compact} fit />
    </Tile>
  {/if}
</Overview>
