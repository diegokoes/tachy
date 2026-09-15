<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { createResource } from "../resource.svelte";
  import { isGlobalAdmin } from "../session.svelte";
  import { t } from "../terms";
  import { Badge, Band, Card, Deck, Dial, Note, G } from "../tui";
  import { census } from "./census.svelte";
  import type { SystemInfo } from "./rows";
  import Figure from "./Figure.svelte";
  import Gaps from "./Gaps.svelte";

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
  const members = $derived(Math.max(0, u.users - u.disabled - u.admins));

  /* userCensus counts admins among the enabled only, so these three partition
     the roll and the widths are the whole of it. */
  const people = $derived([
    { key: "admins", label: "app admins", n: u.admins, tone: "accent" as const },
    { key: "members", label: "members", n: members, tone: "ok" as const },
    { key: "disabled", label: "disabled", n: u.disabled, tone: "muted" as const },
  ]);

  const signin = $derived([
    { key: "password", label: "password", n: u.with_password, tone: "ok" as const },
    { key: "sso", label: "SSO or attribution only", n: sso, tone: "muted" as const },
  ]);

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
    badge?: string;
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
        badge: creds.vault_enabled ? "enabled" : "disabled",
        tone: creds.vault_enabled ? "ok" : "warn",
      });
    }
    if (s && agentCred) {
      out.push({
        key: "agent",
        name: "agent",
        value: `${s.agent_provider.value} · ${s.agent_model.value} · effort ${s.agent_effort.value}`,
        badge: agentCred.source
          ? `${agentCred.key} from ${agentCred.source}`
          : `no ${agentCred.key} — the agent cannot run`,
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
        badge: s.redaction_global.value ? "on" : "off",
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

  onMount(() => system.reload());
</script>

<Deck>
  <Card label="people" span={2} {loading} lines={3}>
    <Figure value={u.users} unit="users" />
    {#if u.users}
      <Band
        segments={people}
        total={u.users}
        label="users by role"
        caption="{u.users - u.disabled} can sign in"
      />
    {/if}
  </Card>

  <Card label="curated {t('teams')}" {loading} lines={3}>
    <div class="dialrow">
      <Dial
        value={teams ? u.teams_with_admin / teams : 1}
        tone={noAdmin ? "warn" : "ok"}
        label="{t('teams')} with an admin"
      >
        <Figure value={u.teams_with_admin} size="sm" />
      </Dial>
      <span class="quiet">of {teams} {t("teams")} have an admin</span>
    </div>
  </Card>

  <Card label="sign-in" {loading} lines={3}>
    <Figure value={u.with_password} unit="with a password" tone="muted" />
    {#if u.users}
      <Band
        segments={signin}
        total={u.users}
        label="how users sign in"
      />
    {/if}
  </Card>

  <Card label="checks" span="full" loading={system.loading} lines={5}>
    {#if !checks.length}
      <span class="quiet">unavailable</span>
    {:else}
      <ul class="checks">
        {#each checks as ch (ch.key)}
          <li class={ch.tone}>
            <span class="dot" aria-hidden="true">{G.dot}</span>
            <span class="name">{ch.name}</span>
            <span class="value">{ch.value}</span>
            {#if ch.badge}
              <Badge tone={ch.tone === "muted" ? "muted" : ch.tone}>
                {ch.badge}
              </Badge>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card label="needs attention" span="full" {loading} lines={2}>
    <Gaps items={gaps} />
  </Card>
</Deck>

{#if census.error || system.error}
  <Note tone="danger">{census.error ?? system.error}</Note>
{/if}

<style>
  .quiet {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .dialrow {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    min-width: 0;
  }

  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    width: 100%;
    min-width: 0;
  }
  .checks li {
    display: grid;
    grid-template-columns: auto minmax(0, 7rem) 1fr auto;
    align-items: baseline;
    gap: var(--pad-2);
    font-size: var(--fs-xs);
  }
  .dot {
    font-family: var(--font-mono);
    color: var(--tone-color);
  }
  .checks .name {
    letter-spacing: var(--label-spacing);
  }
  .value {
    color: var(--muted);
    min-width: 0;
    overflow-wrap: anywhere;
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

  @media (max-width: 40rem) {
    .checks li {
      grid-template-columns: auto 1fr;
    }
    .value,
    .checks li :global(.badge) {
      grid-column: 2;
    }
  }
</style>
