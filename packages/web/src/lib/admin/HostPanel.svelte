<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { Badge, GroupHead, Note } from "../tui";
  import type { SystemInfo } from "./rows";

  type Check = { state: string; value: string };
  type Status = {
    backup?: { ok: boolean; at: string; file?: string; error?: string; dump_bytes?: number };
    restore?: { ok: boolean; at: string; seconds?: number; problems?: string };
    downloads?: { at: string; people: Record<string, { last_download: string; file: string }> };
    watch?: { at: string; posted_to_teams: boolean; checks: Record<string, Check> };
    host?: { at: string; cpu_temp_c: number | null; disk: Record<string, string>; power: string; thermal: string; nvme: string };
  };

  let status = $state<Status | null>(null);
  let visible = $state(true);
  let error = $state<string | null>(null);

  const ago = (iso?: string) => {
    if (!iso) return "never";
    const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
    return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
  };
  const tone = (s: string) => (s === "ok" ? "ok" : s === "warn" ? "warn" : s === "fail" ? "danger" : "muted");

  onMount(async () => {
    try {
      const sys = await api.get<SystemInfo>("/system");
      visible = Boolean(sys.runtime?.status);
      status = (sys.runtime?.status ?? {}) as Status;
    } catch (e) {
      error = errText(e);
    }
  });
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}

{#if !visible}
  <Note>TACHY_STATUS_DIR not mounted. Written by tachy-backup, tachy-watch.</Note>
{:else if status}
  <GroupHead label="backups" />
  <table>
    <tbody>
      <tr>
        <td>Newest backup</td>
        <td><Badge tone={status.backup?.ok ? "ok" : "danger"}>{status.backup ? (status.backup.ok ? "ok" : "failed") : "none"}</Badge></td>
        <td class="muted">{ago(status.backup?.at)}{status.backup?.file ? ` · ${status.backup.file}` : ""}{status.backup?.error ? ` · ${status.backup.error}` : ""}</td>
      </tr>
      <tr>
        <td>Restore test</td>
        <td><Badge tone={status.restore?.ok ? "ok" : "danger"}>{status.restore ? (status.restore.ok ? "ok" : "failed") : "none"}</Badge></td>
        <td class="muted">{ago(status.restore?.at)}{status.restore?.seconds ? ` · took ${status.restore.seconds}s` : ""}{status.restore?.problems ? ` · ${status.restore.problems}` : ""}</td>
      </tr>
      {#each Object.entries(status.downloads?.people ?? {}) as [name, d] (name)}
        <tr><td>Downloaded by {name}</td><td>{ago(d.last_download)}</td><td class="muted">{d.file}</td></tr>
      {:else}
        <tr><td>Laptop downloads</td><td>none recorded</td><td class="muted">run Get-TachyBackup</td></tr>
      {/each}
    </tbody>
  </table>

  <GroupHead label="tachy-watch" />
  {#if status.watch}
    <table>
      <tbody>
        {#each Object.entries(status.watch.checks) as [name, c] (name)}
          <tr><td>{name}</td><td><Badge tone={tone(c.state)}>{c.state}</Badge></td><td class="muted">{c.value}</td></tr>
        {/each}
      </tbody>
    </table>
    <Note>last run {ago(status.watch.at)}{status.watch.posted_to_teams ? " · posted to Teams" : ""}</Note>
  {:else}
    <Note>no tachy-watch run</Note>
  {/if}

  <GroupHead label="host" />
  {#if status.host}
    <table>
      <tbody>
        <tr><td>CPU temperature</td><td>{status.host.cpu_temp_c ?? "?"} °C</td><td class="muted">throttling {status.host.thermal}</td></tr>
        <tr><td>Power</td><td>{status.host.power ?? "?"}</td><td class="muted"></td></tr>
        <tr><td>NVMe</td><td>{status.host.nvme ?? "?"}</td><td class="muted"></td></tr>
        {#each Object.entries(status.host.disk) as [mount, used] (mount)}
          <tr><td>{mount.replace("disk_", "/").replace("/root", "/")}</td><td>{used}</td><td class="muted">used</td></tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <Note>no host data</Note>
  {/if}
{/if}
