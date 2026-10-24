<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "./session.svelte";
  import { t } from "../terms";
  import {
    radarFits,
    EMPTY,
    Bars,
    Cells,
    DataTable,
    Radar,
    type Cell,
    type Col,
    type Column,
  } from "../tui";
  import { activity } from "../admin/activity.svelte";
  import { census } from "../admin/census.svelte";
  import { pct, type Count } from "../admin/overview";
  import Detail from "../admin/Detail.svelte";
  import { col } from "../admin/detail";
  import type { SystemInfo } from "../system/rows";
  import Overview from "../admin/Overview.svelte";
  import Tile from "../admin/Tile.svelte";

  const people = $derived(census.data.detail.users);
  const teams = $derived(census.data.counts.teams ?? 0);
  const admin = $derived(isGlobalAdmin());

  const system = createResource(
    () => api.get<SystemInfo | null>("/system"),
    null,
  );
  onMount(() => system.reload());

  const figures = $derived([
    { key: "users", label: "users", value: people.users, to: "users" },
    { key: "teams", label: t("teams"), value: teams, to: "teams" },
    {
      key: "admins",
      label: "app admins",
      value: people.admins,
      tone: people.admins ? ("accent" as const) : ("danger" as const),
      to: "admins",
    },
    {
      key: "active",
      label: "active 7 d",
      value: activity.data.usage.active_7d,
    },
  ]);

  // userCensus counts app admins and team admins among the enabled and never
  // the same person twice, so these four are the whole roll.
  const members = $derived(
    Math.max(
      0,
      people.users - people.disabled - people.admins - people.team_admins,
    ),
  );
  const roles = $derived<Col[]>([
    {
      key: "admins",
      label: "admins",
      title: "app admins",
      value: people.admins,
    },
    {
      key: "team-admins",
      label: "leads",
      title: `${t("team")} admins`,
      value: people.team_admins,
    },
    { key: "members", label: "members", value: members },
    {
      key: "disabled",
      label: "disabled",
      value: people.disabled,
      tone: "muted",
    },
  ]);

  const config = $derived.by((): Cell[] => {
    const info = system.data;
    if (!info) return [];
    const settings = info.settings;
    const creds = info.credentials;
    const env = info.env;
    const cells: Cell[] = [
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
          ? `${settings.agent_model.value}, fallback key from ${creds.anthropic_api_key}`
          : "no anthropic_api_key in the environment: each user brings their own in settings › agent",
      },
    ];
    cells.push({
      key: "password",
      label: "password sign-in",
      tone: "muted",
      title: `${people.with_password} of ${people.users} users sign in with a password (${pct(people.with_password, people.users)}), the rest through SSO`,
    });
    if (admin)
      cells.push({
        key: "redaction",
        label: "PII redaction",
        tone: settings.redaction_global.value ? "ok" : "muted",
        title: settings.redaction_global.value
          ? "scrubbed at the MCP boundary"
          : "off",
      });
    if (env)
      cells.push(
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
      cells.push({
        key: "profile",
        label: settings.deployment_profile.value,
        tone: "muted",
        title: "deployment profile",
      });
    return cells;
  });

  type Role = (typeof roles)[number];

  const share = (n: number, of: number) => (of ? pct(n, of) : EMPTY);

  const roleColumns: Column<Role>[] = [
    col<Role>("role", "role", (r) => r.title ?? r.label),
    col<Role>("users", "users", (r) => r.value, { end: true }),
    col<Role>("share", "of users", (r) => share(r.value, people.users), {
      end: true,
    }),
  ];
  const roleFigures = $derived<Count[]>([
    { key: "users", label: "users", value: people.users },
    {
      key: "disabled",
      label: "disabled",
      value: people.disabled,
      tone: "muted",
    },
    {
      key: "noteam",
      label: `in no ${t("team")}`,
      value: people.users_no_team,
      tone: people.users_no_team ? "warn" : "muted",
    },
    {
      key: "noadmin",
      label: `${t("teams")} without an admin`,
      value: people.teams_without_admin.length,
      tone: people.teams_without_admin.length ? "warn" : "muted",
    },
  ]);
</script>

{#snippet rolesChart()}
  {#if radarFits(roles.length)}
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
  {:else}
    <Bars rows={roles} />
  {/if}
{/snippet}
{#snippet rolesTable()}
  <DataTable columns={roleColumns} rows={roles} rowKey={(r) => r.key} />
{/snippet}

<Overview
  {figures}
  cols={2}
  loading={census.loading}
  error={census.error ?? activity.error ?? system.error}
>
  <Tile title="config" empty={!config.length}>
    <Cells cells={config} />
  </Tile>

  <Tile
    title="roles"
    key="roles"
    meta={`${people.users}`}
    empty={!people.users}
  >
    {#snippet detail()}
      <Detail figures={roleFigures} loading={census.loading} table={rolesTable}>
        {@render rolesChart()}
      </Detail>
    {/snippet}
    {@render rolesChart()}
  </Tile>
</Overview>
