<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import {
    Band,
    Columns,
    Dial,
    Modal,
    Note,
    Ranking,
    G,
    compact,
    dayOfMonth,
    usd,
    type Col,
  } from "../tui";
  import { activity } from "./activity.svelte";
  import { activeSpy } from "../sections/spy.svelte";
  import { census } from "./census.svelte";
  import type { SystemInfo } from "./rows";
  import Counts from "./Counts.svelte";
  import Gaps from "./Gaps.svelte";
  import Overview from "./Overview.svelte";

  const u = $derived(census.data.detail.users);
  const teams = $derived(census.data.counts.teams ?? 0);
  const loading = $derived(census.loading);
  const admin = $derived(isGlobalAdmin());

  const system = createResource(
    () => api.get<SystemInfo | null>("/system"),
    null,
  );
  const s = $derived(system.data?.settings);
  const creds = $derived(system.data?.credentials);
  const env = $derived(system.data?.env);

  const noAdmin = $derived(Math.max(0, teams - u.teams_with_admin));
  const sso = $derived(Math.max(0, u.users - u.with_password));
  const members = $derived(
    Math.max(0, u.users - u.disabled - u.admins - u.team_admins),
  );

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
    {
      key: "team-admins",
      label: `${t("team")} admins`,
      value: u.team_admins,
      to: "users",
    },
    {
      key: "disabled",
      label: "disabled",
      value: u.disabled,
      tone: "muted" as const,
      to: "users",
    },
  ]);

  /* userCensus counts app admins and team admins among the enabled, and never
     the same person twice, so these four partition the roll and the widths are
     the whole of it. */
  const people = $derived([
    { key: "admins", label: "app admins", n: u.admins, tone: "accent" as const },
    {
      key: "team-admins",
      label: `${t("team")} admins`,
      n: u.team_admins,
      tone: "info" as const,
    },
    { key: "members", label: "members", n: members, tone: "ok" as const },
    { key: "disabled", label: "disabled", n: u.disabled, tone: "muted" as const },
  ]);

  /** What share of the roll has somewhere to put a password. */
  const passwordShare = $derived(u.users ? u.with_password / u.users : 0);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  let showUncurated = $state(false);

  /** Whether the provider the deployment is actually configured to use resolves. */
  const agentCred = $derived.by(() => {
    if (!s || !creds) return null;
    const key =
      s.agent_provider.value === "copilot"
        ? "copilot_token"
        : "anthropic_api_key";
    return { key, source: creds[key] };
  });

  type Check = {
    key: string;
    name: string;
    value: string;
    tone: "ok" | "warn" | "danger" | "muted";
  };

  /* Config states, not counts — nothing here is a ratio, so the honest form is
     a list. Anything failing floats to the top, which is the only reason the
     order is not the order they were written in. */
  /* Failures, then what is working, then the states that are neither. A
     neutral fact floated above a healthy one buries the only rows worth
     reading first. */
  const RANK = { danger: 0, warn: 1, ok: 2, muted: 3 };
  const checks = $derived.by(() => {
    const out: Check[] = [];
    if (creds) {
      out.push({
        key: "vault",
        name: "vault",
        value: creds.vault_enabled
          ? "encrypted, keyed by TACHY_SECRET_KEY"
          : "off — set TACHY_SECRET_KEY to store shared credentials",
        tone: creds.vault_enabled ? "ok" : "warn",
      });
    }
    if (s && agentCred) {
      out.push({
        key: "agent",
        name: "agent",
        /* The one badge that said something the value did not: where the key
           resolves from. It joins the value rather than sitting at the far
           edge of the row. */
        value: [
          s.agent_provider.value,
          s.agent_model.value,
          s.agent_effort.value,
          agentCred.source
            ? `key from ${agentCred.source}`
            : `no ${agentCred.key} — the agent cannot run`,
        ].join(" · "),
        tone: agentCred.source ? "ok" : "danger",
      });
    }
    if (admin && s) {
      out.push({
        key: "profile",
        name: "deployment",
        value: s.deployment_profile.value,
        tone: "muted",
      });
      out.push({
        key: "redaction",
        name: "PII redaction",
        value: s.redaction_global.value ? "scrubbed at the MCP boundary" : "off",
        tone: s.redaction_global.value ? "ok" : "muted",
      });
    }
    if (env) {
      out.push({
        key: "auth",
        name: "auth mode",
        value: env.auth_mode,
        tone: "muted",
      });
      out.push({
        key: "session",
        name: "session secret",
        value: env.session_secret_set ? "set" : "unset",
        tone: env.session_secret_set ? "ok" : "warn",
      });
      out.push({
        key: "token",
        name: "API token",
        value: env.api_token_set ? "set" : "unset",
        tone: env.api_token_set ? "ok" : "muted",
      });
      out.push({
        key: "oidc",
        name: "OIDC",
        value: env.oidc_configured ? "configured" : "off",
        tone: env.oidc_configured ? "ok" : "muted",
      });
    }
    return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  });

  const gaps = $derived([
    {
      n: u.admins ? 0 : 1,
      label: "app admins",
      text: "nobody is an app admin — users and system settings cannot be managed",
      tone: "danger" as const,
      to: "users",
    },
    {
      n: noAdmin,
      label: `${t("teams")} with no admin`,
      tone: "warn" as const,
      to: "users",
    },
    {
      n: u.users_no_team,
      label: `users in no ${t("team")}`,
      tone: "warn" as const,
      to: "users",
    },
  ]);

  const usage = $derived(activity.data.usage);
  const tools = $derived(activity.data.tools);

  const usageFigures = $derived([
    { key: "turns", label: "agent turns", value: usage.turns },
    {
      key: "tokens",
      label: "tokens",
      value: usage.input_tokens + usage.output_tokens,
      detail: `${compact(usage.input_tokens)} in · ${compact(usage.output_tokens)} out`,
    },
    { key: "active", label: "active this week", value: usage.active_7d },
  ]);

  const tokensPerDay = $derived(
    usage.per_day.map(
      (d): Col => ({ key: d.day, label: dayOfMonth(d.day), value: d.tokens }),
    ),
  );

  /* Fixed order of tones, assigned by rank: a model is a category, and past four
     the tail folds into "other" rather than inventing a fifth colour. */
  const MODEL_TONES = ["accent", "info", "ok", "warn"] as const;
  const modelMix = $derived.by(() => {
    const head = usage.by_model.slice(0, 3).map((m, i) => ({
      key: m.model,
      label: m.model,
      n: m.tokens,
      tone: MODEL_TONES[i],
    }));
    const rest = usage.by_model.slice(3).reduce((n, m) => n + m.tokens, 0);
    return rest
      ? [...head, { key: "other", label: "other", n: rest, tone: "muted" as const }]
      : head;
  });
  const modelTokens = $derived(modelMix.reduce((n, m) => n + m.n, 0));

  const heaviest = $derived(
    (usage.top_users ?? []).map((u) => ({
      key: u.email,
      label: u.email,
      note: `${u.turns} turns · ${usd(u.cost_usd)}`,
      value: compact(u.tokens),
    })),
  );

  const toolMix = $derived([
    { key: "reads", label: "reads", n: tools.reads, tone: "accent" as const },
    { key: "writes", label: "writes", n: tools.writes, tone: "warn" as const },
  ]);

  /* A failure is only news here when the agent caused it: "held it wrong" is
     feedback on that tool's description, which no outage dashboard shows. */
  const topTools = $derived(
    tools.tools.map((x) => ({
      key: x.tool,
      label: x.tool,
      note: [
        x.writes ? "writes" : null,
        x.misuse ? `${x.misuse} misused` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      tone: x.misuse ? ("warn" as const) : undefined,
      value: compact(x.calls),
    })),
  );

  const writers = $derived(
    (tools.writers ?? []).map((w) => ({
      key: w.email,
      label: w.email,
      value: compact(w.writes),
    })),
  );

  onMount(() => system.reload());
</script>

<Overview>
  {#snippet counts()}
    <Counts items={figures} {loading} />
  {/snippet}

  {#snippet health()}
    <div class="row">
      <button
        class="one ring-button"
        title="list the {t('teams')} without an admin"
        onclick={() => (showUncurated = true)}
      >
        <Dial
          value={teams ? u.teams_with_admin / teams : 1}
          tone={noAdmin ? "warn" : "ok"}
          label="{t('teams')} with an admin"
        >
          <span class="core">{teams ? pct(u.teams_with_admin / teams) : "—"}</span>
        </Dial>
        <span class="name">{t("teams")} with admin</span>
      </button>

      <div class="one">
        <Dial
          value={passwordShare}
          tone="ok"
          rest="info"
          label="users who sign in with a password"
        >
          <span class="core">{u.users ? pct(passwordShare) : "—"}</span>
        </Dial>
        <span class="name">sign-in</span>
        <span class="legend">
          <span class="key ok">{u.with_password} password</span>
          <span class="key info">{sso} SSO</span>
        </span>
      </div>

      <div class="checks-wrap">
        {#if !checks.length}
          <span class="quiet">
            {system.loading ? "checking…" : "unavailable"}
          </span>
        {:else}
          <ul class="checks">
            {#each checks as ch (ch.key)}
              <li class={ch.tone}>
                <span class="dot" aria-hidden="true">{G.dot}</span>
                <span class="check-name">{ch.name}</span>
                <span class="value">{ch.value}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet detail()}
    {#if u.users}
      <Band segments={people} total={u.users} label="users by role" />
    {/if}

    <div class="activity">
      <div class="block">
        <span class="title">
          agent · last {usage.days} days · {usd(usage.cost_usd)} estimated
        </span>
        <Counts items={usageFigures} loading={activity.loading} />
        {#if usage.turns}
          <Columns rows={tokensPerDay} format={compact} height="5rem" />
          {#if modelTokens}
            <Band segments={modelMix} total={modelTokens} label="tokens by model" />
          {/if}
          {#if heaviest.length}
            <span class="subtitle">heaviest users</span>
            <Ranking rows={heaviest} />
          {/if}
        {:else}
          <span class="quiet">no agent turns in the last {usage.days} days</span>
        {/if}
      </div>

      <div class="block">
        <span class="title">
          agent tools · last {tools.days} days · {compact(tools.reads + tools.writes)} calls
        </span>
        {#if tools.reads + tools.writes}
          <Band segments={toolMix} total={tools.reads + tools.writes} label="tool calls, reads against writes" />
          <span class="subtitle">most used</span>
          <Ranking rows={topTools} />
          {#if writers.length}
            <span class="subtitle">who has the agent change things</span>
            <Ranking rows={writers} />
          {/if}
        {:else}
          <span class="quiet">no tool calls recorded yet</span>
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet attention()}
    <Gaps items={gaps} />
  {/snippet}
</Overview>

{#if showUncurated}
  <Modal
    title="{t('teams')} without an admin"
    cancelLabel="close"
    width="26rem"
    onCancel={() => (showUncurated = false)}
  >
    {#if u.teams_without_admin.length}
      <ul class="uncurated">
        {#each u.teams_without_admin as team (team.slug)}
          <li>{team.name} <span class="slug">{team.slug}</span></li>
        {/each}
      </ul>
      <button
        class="go"
        onclick={() => {
          showUncurated = false;
          activeSpy()?.goto("users");
        }}>assign one in users &amp; roles {G.right}</button
      >
    {:else}
      <p class="quiet">every {t("team")} has an admin</p>
    {/if}
  </Modal>
{/if}

{#if census.error || system.error}
  <Note tone="danger">{census.error ?? system.error}</Note>
{/if}

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--pad-4);
    min-width: 0;
  }
  .one {
    flex: 0 1 8rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--pad-1);
    text-align: center;
  }
  .ring-button {
    padding: var(--pad-2);
    margin: calc(var(--pad-2) * -1);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .ring-button:hover,
  .ring-button:focus-visible {
    background: color-mix(in srgb, var(--muted) 12%, transparent);
  }

  .core {
    font-family: var(--font-mono);
    font-size: var(--fs-lg);
  }
  .name {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0 var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .key::before {
    content: "";
    display: inline-block;
    width: 0.42em;
    height: 0.85em;
    margin-right: var(--pad-1);
    vertical-align: middle;
    border-radius: 1px;
    background: var(--tone-color);
  }

  /* A grid, not a table stretched to the window: with the badges gone there is
     nothing to push to the right edge, so each check stays next to its name. */
  .checks-wrap {
    flex: 1 1 22rem;
    min-width: 0;
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: var(--pad-2) var(--pad-4);
    width: 100%;
    min-width: 0;
  }
  .checks li {
    display: grid;
    grid-template-columns: auto minmax(0, 7rem) 1fr;
    align-items: baseline;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
  }
  .dot {
    font-family: var(--font-mono);
    color: var(--tone-color);
  }
  .check-name {
    letter-spacing: var(--label-spacing);
  }
  .value {
    color: var(--muted);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .activity {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: calc(var(--pad-4) * 2);
    margin-top: var(--pad-4);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
  }
  .title {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .subtitle {
    margin-top: var(--pad-2);
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .quiet {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .uncurated {
    list-style: none;
    margin: 0 0 var(--pad-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    font-size: var(--fs-sm);
  }
  .slug {
    margin-left: var(--pad-2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .go {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--accent);
    cursor: pointer;
  }

  .ok {
    --tone-color: var(--ok);
  }
  .warn {
    --tone-color: var(--warn);
  }
  .danger {
    --tone-color: var(--danger);
  }
  .muted {
    --tone-color: var(--muted);
  }
  .info {
    --tone-color: var(--info);
  }
</style>
