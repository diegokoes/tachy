<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Badge, Button, GroupHead, Note, Time } from "../tui";
  import type { SystemInfo } from "./rows";
  import { system as shared } from "./systemState.svelte";

  let system = $state<SystemInfo | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function load() {
    try {
      system = await api.get<SystemInfo>("/system");
      error = null;
    } catch (e) {
      error = errText(e);
    }
  }

  async function setMaintenance(refuse: boolean) {
    busy = true;
    try {
      await api.post("/system/maintenance", { refuse_chats: refuse });
      await load();
      void shared.reload();
    } catch (e) {
      error = errText(e);
    } finally {
      busy = false;
    }
  }

  const mib = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MiB`;
  const release = $derived(
    (system?.runtime?.status?.release ?? null) as {
      at?: string;
      commit?: string;
      image?: string;
      result?: string;
      schema?: string;
    } | null,
  );

  // Current values only, refreshed while the page is open.
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void load();
    timer = setInterval(load, 10_000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}

{#if system?.runtime}
  {@const runtime = system.runtime}
  <GroupHead label="state" />
  <table>
    <tbody>
      <tr>
        <td>Readiness</td>
        <td
          ><Badge tone={runtime.readiness.ready ? "ok" : "danger"}
            >{runtime.readiness.ready ? "ready" : "not ready"}</Badge
          ></td
        >
        <td class="muted"
          >database {runtime.readiness.database ? "up" : "down"} · schema {runtime
            .readiness.schema} · model {runtime.readiness
            .model}{runtime.draining ? " · draining" : ""}</td
        >
      </tr>
      <tr>
        <td>Release</td>
        <td
          >{system.env?.commit ?? "unknown"}{system.env?.env_badge
            ? ` (${system.env.env_badge})`
            : ""}</td
        >
        <td class="muted">
          {#if release}last deploy {release.result}
            <Time at={release.at} /> · {release.image ?? ""}{:else}no deploy
            recorded{/if}
        </td>
      </tr>
      <tr>
        <td>Maintenance</td>
        <td>
          <Badge tone={runtime.refusingChats ? "warn" : "muted"}
            >{runtime.refusingChats ? "chats paused" : "off"}</Badge
          >
        </td>
        <td>
          <Button
            variant="ghost"
            size="sm"
            {busy}
            onclick={() => setMaintenance(!runtime.refusingChats)}
            >{runtime.refusingChats
              ? "resume chats"
              : "pause new chats"}</Button
          >
          <span class="muted">refuses new chats; running turns finish</span>
        </td>
      </tr>
    </tbody>
  </table>

  <GroupHead label="runtime · 10 s refresh" />
  <table>
    <thead><tr><th>what</th><th>now</th><th>detail</th></tr></thead>
    <tbody>
      <tr>
        <td>Chat slots</td>
        <td>{runtime.turns.slotsUsed} / {runtime.turns.slotCap}</td>
        <td class="muted"
          >running {runtime.turns.running} · queued {runtime.turns.queued} · refused
          since boot
          {runtime.turns.rejectedSinceBoot}</td
        >
      </tr>
      <tr>
        <td>Approvals waiting</td>
        <td>{runtime.turns.pendingApprovals}</td>
        <td class="muted"
          >{runtime.turns.oldestApprovalAgeSeconds === null
            ? "none"
            : `oldest ${Math.round(runtime.turns.oldestApprovalAgeSeconds / 60)} min`}</td
        >
      </tr>
      <tr>
        <td>API memory</td>
        <td
          >{runtime.memory
            ? `${mib(runtime.memory.currentBytes)}${runtime.memory.maxBytes ? ` / ${mib(runtime.memory.maxBytes)}` : ""}`
            : "unknown"}</td
        >
        <td class="muted"
          >{runtime.memory?.percent != null
            ? `${runtime.memory.percent}% of container limit`
            : "no cgroup limit"}</td
        >
      </tr>
      <tr>
        <td>Event loop delay</td>
        <td>{runtime.eventLoopP99Ms} ms</td>
        <td class="muted">p99, last 60 s</td>
      </tr>
      <tr>
        <td>Embedding queue</td>
        <td
          >{runtime.embed
            ? `${runtime.embed.queries} queries · ${runtime.embed.passages} passages`
            : "unknown"}</td
        >
        <td class="muted"
          >{runtime.embed
            ? `${runtime.embed.callers} waiting · ${runtime.embed.running ? "busy" : "idle"}`
            : ""}</td
        >
      </tr>
      {#if "error" in runtime.postgres}
        <tr
          ><td>Postgres connections</td><td>unknown</td><td class="muted"
            >{runtime.postgres.error}</td
          ></tr
        >
      {:else}
        <tr>
          <td>Postgres connections</td>
          <td
            >{runtime.postgres.byProcess.reduce((n, p) => n + p.n, 0)} / {runtime
              .postgres.max}</td
          >
          <td class="muted"
            >{runtime.postgres.byProcess
              .map((p) => `${p.name} ${p.state} ${p.n}`)
              .join(" · ")}</td
          >
        </tr>
      {/if}
    </tbody>
  </table>

  <GroupHead label="security" />
  <table>
    <tbody>
      <tr
        ><td>Single sign-on</td><td
          >{runtime.security.sso_configured
            ? "configured"
            : "not configured"}</td
        ><td class="muted"
          >{runtime.security.sso_configured
            ? `password allowed: ${runtime.security.password_login_under_sso} account(s)`
            : "password only"}</td
        ></tr
      >
      <tr>
        <td>Credential vault</td>
        <td
          >{runtime.security.vault.enabled
            ? (runtime.security.vault.current_key ?? "on")
            : "disabled"}</td
        >
        <td class="muted">
          {#if runtime.security.vault.enabled}
            {runtime.security.vault.by_key
              .map(
                (k) =>
                  `${k.key_id ?? "no key id"}: ${k.count}${k.current ? " (current)" : ""}`,
              )
              .join(" · ") || "nothing stored"}
            {#if runtime.security.vault.by_key.some((k) => !k.current)}
              · run npm run sync rotate-key
            {/if}
          {:else}TACHY_SECRET_KEY unset{/if}
        </td>
      </tr>
      <tr
        ><td>Accounts with a password</td><td
          >{runtime.security.users_with_password}</td
        ><td class="muted"
          >{runtime.security.service_accounts} service account(s)</td
        ></tr
      >
    </tbody>
  </table>

  <GroupHead label="data and retention" />
  <table>
    <thead><tr><th>table</th><th>size</th><th>rows (estimate)</th></tr></thead>
    <tbody>
      {#each runtime.tableSizes as tableSize (tableSize.table)}
        <tr
          ><td>{tableSize.table}</td><td>{mib(tableSize.bytes)}</td><td
            class="muted">{Math.max(0, Math.round(tableSize.rows))}</td
          ></tr
        >
      {/each}
    </tbody>
  </table>
  <Note
    >uploads: {runtime.uploadTtlHours} h. transcripts, usage counters: retention.sweep
    (workers › jobs)</Note
  >
{:else if !error}
  <p class="muted">Loading…</p>
{/if}
