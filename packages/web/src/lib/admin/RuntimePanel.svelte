<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Badge, Button, GroupHead, Note } from "../tui";
  import type { SystemInfo } from "./rows";

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

  /* Current values only; a light refresh keeps them honest while the page is open. */
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    void load();
    timer = setInterval(load, 10_000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}

{#if system?.runtime}
  {@const r = system.runtime}
  <GroupHead label="state" />
  <table>
    <tbody>
      <tr>
        <td>Readiness</td>
        <td><Badge tone={r.readiness.ready ? "ok" : "danger"}>{r.readiness.ready ? "ready" : "not ready"}</Badge></td>
        <td class="muted">database {r.readiness.database ? "up" : "down"} · schema {r.readiness.schema} · model {r.readiness.model}{r.draining ? " · draining" : ""}</td>
      </tr>
      <tr>
        <td>Release</td>
        <td>{system.env?.commit ?? "unknown"}{system.env?.env_badge ? ` (${system.env.env_badge})` : ""}</td>
        <td class="muted">
          {#if release}last deploy {release.result} {release.at} · {release.image ?? ""}{:else}no deploy recorded on this host{/if}
        </td>
      </tr>
      <tr>
        <td>Maintenance</td>
        <td>
          <Badge tone={r.refusingChats ? "warn" : "muted"}>{r.refusingChats ? "chats paused" : "off"}</Badge>
        </td>
        <td>
          <Button
            variant="ghost"
            size="sm"
            {busy}
            onclick={() => setMaintenance(!r.refusingChats)}
            >{r.refusingChats ? "resume chats" : "pause new chats"}</Button
          >
          <span class="muted">before a deploy: running turns finish, new ones are refused, the rest keeps serving</span>
        </td>
      </tr>
    </tbody>
  </table>

  <GroupHead label="runtime (refreshes every 10 s)" />
  <table>
    <thead><tr><th>what</th><th>now</th><th>detail</th></tr></thead>
    <tbody>
      <tr>
        <td>Chat slots</td>
        <td>{r.turns.slotsUsed} / {r.turns.slotCap}</td>
        <td class="muted">running {Object.entries(r.turns.running).map(([p, n]) => `${p} ${n}`).join(", ") || "none"} · queued {r.turns.queued} · refused since boot {r.turns.rejectedSinceBoot}</td>
      </tr>
      <tr>
        <td>Approvals waiting</td>
        <td>{r.turns.pendingApprovals}</td>
        <td class="muted">{r.turns.oldestApprovalAgeSeconds === null ? "none" : `oldest ${Math.round(r.turns.oldestApprovalAgeSeconds / 60)} min`}</td>
      </tr>
      <tr>
        <td>API memory</td>
        <td>{r.memory ? `${mib(r.memory.currentBytes)}${r.memory.maxBytes ? ` / ${mib(r.memory.maxBytes)}` : ""}` : "unknown"}</td>
        <td class="muted">{r.memory?.percent != null ? `${r.memory.percent}% of the container limit (turns live here)` : "no cgroup limit visible"}</td>
      </tr>
      <tr>
        <td>Event loop delay</td>
        <td>{r.eventLoopP99Ms} ms</td>
        <td class="muted">p99 over the last minute</td>
      </tr>
      <tr>
        <td>Embedding queue</td>
        <td>{r.embed ? `${r.embed.queries} queries · ${r.embed.passages} passages` : "unknown"}</td>
        <td class="muted">{r.embed ? `${r.embed.callers} callers waiting · ${r.embed.running ? "busy" : "idle"}` : ""}</td>
      </tr>
      {#if "error" in r.postgres}
        <tr><td>Postgres connections</td><td>unknown</td><td class="muted">{r.postgres.error}</td></tr>
      {:else}
        <tr>
          <td>Postgres connections</td>
          <td>{r.postgres.byProcess.reduce((n, p) => n + p.n, 0)} / {r.postgres.max}</td>
          <td class="muted">{r.postgres.byProcess.map((p) => `${p.name} ${p.state} ${p.n}`).join(" · ")}</td>
        </tr>
      {/if}
    </tbody>
  </table>

  <GroupHead label="security" />
  <table>
    <tbody>
      <tr><td>Single sign-on</td><td>{r.security.sso_configured ? "configured" : "not configured"}</td><td class="muted">{r.security.sso_configured ? `password login allowed for ${r.security.password_login_under_sso} account(s)` : "password login is the only login"}</td></tr>
      <tr>
        <td>Credential vault</td>
        <td>{r.security.vault.enabled ? (r.security.vault.current_key ?? "on") : "disabled"}</td>
        <td class="muted">
          {#if r.security.vault.enabled}
            {r.security.vault.by_key.map((k) => `${k.key_id ?? "no key id"}: ${k.count}${k.current ? " (current)" : ""}`).join(" · ") || "nothing stored"}
            {#if r.security.vault.by_key.some((k) => !k.current)}
              — run `npm run sync rotate-key` to move the rest over
            {/if}
          {:else}TACHY_SECRET_KEY is not set{/if}
        </td>
      </tr>
      <tr><td>Accounts with a password</td><td>{r.security.users_with_password}</td><td class="muted">{r.security.service_accounts} service account(s)</td></tr>
    </tbody>
  </table>

  <GroupHead label="data and retention" />
  <table>
    <thead><tr><th>table</th><th>size</th><th>rows (estimate)</th></tr></thead>
    <tbody>
      {#each r.tableSizes as t (t.table)}
        <tr><td>{t.table}</td><td>{mib(t.bytes)}</td><td class="muted">{Math.max(0, Math.round(t.rows))}</td></tr>
      {/each}
    </tbody>
  </table>
  <Note>Chat uploads are kept {r.uploadTtlHours} h. Transcripts and usage counters follow the retention.sweep job's parameters (integrations › jobs).</Note>
{:else if !error}
  <p class="muted">Loading…</p>
{/if}
