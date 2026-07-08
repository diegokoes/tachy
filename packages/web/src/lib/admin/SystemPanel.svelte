<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { initSession } from "../session.svelte";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { errText, type SystemInfo } from "./shared";

  let system = $state<SystemInfo | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  // Editable drafts for the text settings; applied per-row on demand.
  let draft = $state<Record<string, string>>({});

  function syncDraft() {
    if (!system) return;
    draft = {
      agent_model: system.settings.agent_model.value,
      allowed_models: system.settings.allowed_models.value.join(", "),
      org_name: system.settings.org_name.value ?? "",
    };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      system = await api.get("/system");
      syncDraft();
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function saveSetting(key: string, value: unknown) {
    error = null;
    try {
      const res = await api.put<{ settings: SystemInfo["settings"] }>(`/settings/${key}`, { value });
      if (system) system = { ...system, settings: res.settings };
      syncDraft();
      // the deployment profile drives terminology app-wide - refresh the session config
      if (key === "deployment_profile") await initSession();
    } catch (e) {
      error = errText(e);
    }
  }

  onMount(load);
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if loading}<p class="muted">Loading…</p>{/if}

{#if system}
  <h4>Runtime settings <span class="muted">(stored in the database - editable)</span></h4>
  <table>
    <thead><tr><th>setting</th><th>value</th>
      <th class="tip" title="db: set here. env: falling back to the environment variable. default: built-in.">source</th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="tip" title="Support/business relabels nothing; Engineering/repositories reads product→repository, team→organization and hides customers. Display only - slugs and the agent contract never change.">Deployment profile</td>
        <td>
          <AsciiSelect value={system.settings.deployment_profile.value}
            options={[
              { value: "support", label: "support / business" },
              { value: "engineering", label: "engineering / repositories" },
            ]}
            onchange={(v) => saveSetting("deployment_profile", v)} />
        </td>
        <td><span class="badge src-{system.settings.deployment_profile.source}">{system.settings.deployment_profile.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="When on, PII/secrets are scrubbed from everything sent to the LLM - all connections, pasted context and retrieved results. The database keeps raw data.">PII / secret redaction</td>
        <td>
          <label class="check">
            <input type="checkbox" checked={system.settings.redaction_global.value}
              onchange={(e) => saveSetting("redaction_global", (e.target as HTMLInputElement).checked)} />
            <span class:on={system.settings.redaction_global.value}>
              {system.settings.redaction_global.value ? "on - scrub at the LLM boundary" : "off (per-connection opt-in only)"}
            </span>
          </label>
        </td>
        <td><span class="badge src-{system.settings.redaction_global.source}">{system.settings.redaction_global.source}</span></td>
      </tr>
      <tr>
        <td>Agent model</td>
        <td class="edit-cell">
          <input bind:value={draft.agent_model} />
          {#if draft.agent_model !== system.settings.agent_model.value}
            <button class="mini" onclick={() => saveSetting("agent_model", draft.agent_model.trim())}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.agent_model.source}">{system.settings.agent_model.source}</span></td>
      </tr>
      <tr>
        <td>Agent effort</td>
        <td>
          <AsciiSelect value={system.settings.agent_effort.value}
            options={["low", "medium", "high", "xhigh", "max"]}
            onchange={(v) => saveSetting("agent_effort", v)} />
        </td>
        <td><span class="badge src-{system.settings.agent_effort.source}">{system.settings.agent_effort.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Comma-separated; empty = unrestricted.">Model allowlist</td>
        <td class="edit-cell">
          <input bind:value={draft.allowed_models} placeholder="unrestricted" />
          {#if draft.allowed_models !== system.settings.allowed_models.value.join(", ")}
            <button class="mini" onclick={() => saveSetting("allowed_models", draft.allowed_models.split(",").map((s) => s.trim()).filter(Boolean))}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.allowed_models.source}">{system.settings.allowed_models.source}</span></td>
      </tr>
      <tr>
        <td>Organization name</td>
        <td class="edit-cell">
          <input bind:value={draft.org_name} />
          {#if draft.org_name !== (system.settings.org_name.value ?? "") && draft.org_name.trim()}
            <button class="mini" onclick={() => saveSetting("org_name", draft.org_name.trim())}>apply</button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.org_name.source}">{system.settings.org_name.source}</span></td>
      </tr>
    </tbody>
  </table>
  <p class="muted hint">Changes apply to the next agent turn / MCP start - no restart needed for the web agent.</p>

  <h4>Environment <span class="muted">(bootstrap + secrets - read-only, set in .env)</span></h4>
  <table>
    <thead><tr><th>setting</th><th>value</th><th>env var</th></tr></thead>
    <tbody>
      <tr>
        <td>Auth</td>
        <td>{system.env.auth_mode}{system.env.auth_mode === "open" ? " (wizard/password login takes over once set up)" : ""}</td>
        <td class="muted">OIDC_* {system.env.oidc_configured ? "(set)" : "(unset)"} · TACHY_API_TOKEN {system.env.api_token_set ? "(set)" : "(unset)"}</td>
      </tr>
      <tr>
        <td>Session secret</td>
        <td>{system.env.session_secret_set ? "set" : "not set - ephemeral; sessions reset on restart"}</td>
        <td class="muted">TACHY_SESSION_SECRET</td>
      </tr>
      <tr><td>Anthropic API key</td><td>{system.env.anthropic_api_key_set ? "set" : "not set (falls back to the server's Claude Code login)"}</td><td class="muted">ANTHROPIC_API_KEY</td></tr>
      <tr><td>Attribution email (standalone MCP)</td><td>{system.env.user_email ?? "(anonymous)"}</td><td class="muted">TACHY_USER_EMAIL</td></tr>
      <tr><td>Upload dir</td><td>{system.env.upload_dir ?? "(OS tmp dir)"}</td><td class="muted">TACHY_UPLOAD_DIR</td></tr>
      <tr><td>API port</td><td>{system.env.port}</td><td class="muted">PORT</td></tr>
    </tbody>
  </table>
{/if}

<style>
  td .on { color: var(--ok); }
  .edit-cell { display: flex; gap: 0.4rem; align-items: center; }
  .edit-cell input { min-width: 13rem; }
  label.check { display: flex; gap: 0.5rem; align-items: center; cursor: pointer; }
  label.check input { accent-color: var(--accent); }
  .badge {
    font-size: 0.72rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.05rem 0.55rem;
    color: var(--muted);
  }
  .badge.src-db { border-color: var(--accent); color: var(--accent); }
  .badge.src-env { border-color: var(--warn); color: var(--warn); }
</style>
