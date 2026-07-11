<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./api";
  import { session } from "./session.svelte";
  import AsciiSelect from "./AsciiSelect.svelte";
  import { AGENT_KEY_LABELS, errText } from "./admin/shared";

  type PrefSource = "user" | "team" | "db" | "env" | "default";
  type Prefs = {
    agent_provider: { value: "claude" | "copilot"; source: PrefSource };
    agent_model: { value: string; source: PrefSource };
    agent_effort: { value: string; source: PrefSource };
  };
  type MyCreds = {
    vault_enabled: boolean;
    mine: { name: string; updated_at: string }[];
    effective: Record<string, "user" | "team" | "global" | "env" | null>;
  };

  let prefs = $state<Prefs | null>(null);
  let creds = $state<MyCreds | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  let modelDraft = $state("");
  let keyDrafts = $state<Record<string, string>>({});

  const credNames = $derived(creds ? Object.keys(creds.effective) : []);
  const agentKeyNames = $derived(credNames.filter((n) => n in AGENT_KEY_LABELS));
  const sourceTokenNames = $derived(credNames.filter((n) => !(n in AGENT_KEY_LABELS)));

  const mine = $derived(new Set(creds?.mine.map((m) => m.name) ?? []));

  function sourceLabel(src: PrefSource | "global" | null): string {
    if (src === null) return "unset";
    if (src === "db") return "global";
    return src;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      [prefs, creds] = await Promise.all([
        api.get<Prefs>("/me/preferences"),
        api.get<MyCreds>("/me/credentials"),
      ]);
      modelDraft = prefs.agent_model.source === "user" ? prefs.agent_model.value : "";
      keyDrafts = {};
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function setPref(key: string, value: unknown) {
    error = null;
    try {
      await api.put(`/me/preferences/${key}`, { value });
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function resetPref(key: string) {
    error = null;
    try {
      await api.delete(`/me/preferences/${key}`);
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function saveKey(name: string) {
    const value = keyDrafts[name]?.trim();
    if (!value) return;
    error = null;
    try {
      await api.put(`/me/credentials/${encodeURIComponent(name)}`, { value });
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function removeKey(name: string) {
    error = null;
    try {
      await api.delete(`/me/credentials/${encodeURIComponent(name)}`);
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  onMount(load);
</script>

<div class="my-settings">
  <h3>My settings <span class="muted">{session.me?.email ?? ""}</span></h3>
  <p class="muted">
    Personal overrides for the agent. Anything unset falls back team → global →
    server environment. Keys are stored encrypted and are never shown again.
  </p>

  {#if error}<p class="error">{error}</p>{/if}
  {#if loading && !prefs}<p class="muted">Loading…</p>{/if}

  {#if prefs}
    <h4>Agent</h4>
    <table>
      <thead><tr><th>setting</th><th>value</th>
        <th class="tip" title="user: your override. team/global: inherited. env: server environment variable. default: built-in.">source</th><th></th>
      </tr></thead>
      <tbody>
        <tr>
          <td>Provider</td>
          <td>
            <AsciiSelect value={prefs.agent_provider.value}
              options={[
                { value: "claude", label: "claude (Anthropic)" },
                { value: "copilot", label: "copilot (GitHub)" },
              ]}
              onchange={(v) => setPref("agent_provider", v)} />
          </td>
          <td><span class="badge">{sourceLabel(prefs.agent_provider.source)}</span></td>
          <td>{#if prefs.agent_provider.source === "user"}<button class="mini ghost" onclick={() => resetPref("agent_provider")}>reset</button>{/if}</td>
        </tr>
        <tr>
          <td>Model</td>
          <td class="edit-cell">
            <input bind:value={modelDraft} placeholder={prefs.agent_model.value} />
            {#if modelDraft.trim() && modelDraft.trim() !== prefs.agent_model.value}
              <button class="mini" onclick={() => setPref("agent_model", modelDraft.trim())}>apply</button>
            {/if}
          </td>
          <td><span class="badge">{sourceLabel(prefs.agent_model.source)}</span></td>
          <td>{#if prefs.agent_model.source === "user"}<button class="mini ghost" onclick={() => resetPref("agent_model")}>reset</button>{/if}</td>
        </tr>
        <tr>
          <td>Effort</td>
          <td>
            <AsciiSelect value={prefs.agent_effort.value}
              options={["low", "medium", "high", "xhigh", "max"]}
              onchange={(v) => setPref("agent_effort", v)} />
          </td>
          <td><span class="badge">{sourceLabel(prefs.agent_effort.source)}</span></td>
          <td>{#if prefs.agent_effort.source === "user"}<button class="mini ghost" onclick={() => resetPref("agent_effort")}>reset</button>{/if}</td>
        </tr>
      </tbody>
    </table>
  {/if}

  {#if creds}
    <h4>My keys</h4>
    {#if !creds.vault_enabled}
      <p class="muted">Credential storage is disabled on this server — set
        <code>TACHY_SECRET_KEY</code> (32 bytes base64) in the server environment to
        enable per-user keys. Until then keys come from <code>.env</code>.</p>
    {:else}
      <table>
        <thead><tr><th>credential</th><th>set a new value</th>
          <th class="tip" title="Which scope currently wins for you: your key, your team's, the global one, or a server env var.">active source</th><th></th>
        </tr></thead>
        <tbody>
          {#each [...agentKeyNames, ...sourceTokenNames] as name (name)}
            <tr>
              <td>{AGENT_KEY_LABELS[name] ?? name}</td>
              <td class="edit-cell">
                <input type="password" bind:value={keyDrafts[name]}
                  placeholder={mine.has(name) ? "(set — enter to replace)" : "(not set)"} autocomplete="off" />
                {#if keyDrafts[name]?.trim()}
                  <button class="mini" onclick={() => saveKey(name)}>save</button>
                {/if}
              </td>
              <td><span class="badge" class:on={creds.effective[name] === "user"}>{sourceLabel(creds.effective[name])}</span></td>
              <td>{#if mine.has(name)}<button class="mini ghost" onclick={() => removeKey(name)}>remove mine</button>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .my-settings { display: flex; flex-direction: column; gap: 0.75rem; max-width: 60rem; }
  h3 { margin: 0; }
  h4 { margin: 0.8rem 0 0.2rem; }
  .muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
  .error { color: var(--danger); margin: 0; }
  .edit-cell input { min-width: 16rem; }
  code { background: var(--accent-dim); border-radius: 3px; padding: 0 0.3em; font-size: 0.92em; }
</style>
