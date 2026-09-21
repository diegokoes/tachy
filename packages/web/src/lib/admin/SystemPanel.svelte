<script lang="ts">
  import { PROVIDER_OPTIONS } from "../vocab";
  import { AGENT_EFFORTS } from "@tachy/contract";
  import { onMount } from "svelte";
  import { api } from "../api";
  import { initSession } from "../session.svelte";
  import AsciiSelect from "../AsciiSelect.svelte";
  import Checkbox from "../tui/Checkbox.svelte";
  import Icon from "../tui/Icon.svelte";
  import { errText } from "../resource.svelte";
  import type { SystemInfo } from "./rows";
  import { system as shared } from "./systemState.svelte";
import { csv } from "../fields";
  import { Button, GroupHead } from "../tui";

  let system = $state<SystemInfo | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  
  let draft = $state<Record<string, string>>({});

  function syncDraft() {
    if (!system) return;
    draft = {
      agent_model: system.settings.agent_model.value,
      allowed_models: system.settings.allowed_models.value.join(", "),
      org_name: system.settings.org_name.value ?? "",
      agent_slot_cap: String(system.settings.agent_slot_cap.value),
      copilot_slot_weight: String(system.settings.copilot_slot_weight.value),
      agent_queue_max: String(system.settings.agent_queue_max.value),
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
      /* The overview behind this dialog reads its own copy; refresh it so the
         setting shows there the moment the dialog closes. */
      void shared.reload();
      
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
  <table>
    <thead><tr><th>setting</th><th>value</th>
      <th class="tip" title="db: set here. env: environment variable. default: built-in.">source</th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="tip" title="engineering: product→repository, team→organization, customers hidden. Labels only.">Deployment profile</td>
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
        <td class="tip" title="Scrubs PII and secrets from all LLM input. Database keeps raw data.">PII / secret redaction</td>
        <td>
          <label class="check">
            <Checkbox
              checked={system.settings.redaction_global.value}
              ariaLabel="PII / secret redaction"
              onchange={(checked) => saveSetting("redaction_global", checked)}
            />
            <span class="state" class:on={system.settings.redaction_global.value}>
              <Icon
                name={system.settings.redaction_global.value ? "lockOn" : "lockOff"}
                size="1em"
                weight={7}
              />
              {system.settings.redaction_global.value ? "on: LLM boundary" : "off: per-connection opt-in"}
            </span>
          </label>
        </td>
        <td><span class="badge src-{system.settings.redaction_global.source}">{system.settings.redaction_global.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Chat backend. claude: API key or Claude Code login. copilot: token or CLI login.">Agent provider</td>
        <td>
          <AsciiSelect value={system.settings.agent_provider.value}
            options={PROVIDER_OPTIONS}
            onchange={(v) => saveSetting("agent_provider", v)} />
        </td>
        <td><span class="badge src-{system.settings.agent_provider.source}">{system.settings.agent_provider.source}</span></td>
      </tr>
      <tr>
        <td>Agent model</td>
        <td class="edit-cell">
          <input bind:value={draft.agent_model} />
          {#if draft.agent_model !== system.settings.agent_model.value}
            <Button size="sm" onclick={() => saveSetting("agent_model", draft.agent_model.trim())}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.agent_model.source}">{system.settings.agent_model.source}</span></td>
      </tr>
      <tr>
        <td>Agent effort</td>
        <td>
          <AsciiSelect value={system.settings.agent_effort.value}
            options={[...AGENT_EFFORTS]}
            onchange={(v) => saveSetting("agent_effort", v)} />
        </td>
        <td><span class="badge src-{system.settings.agent_effort.source}">{system.settings.agent_effort.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Comma-separated. Empty: unrestricted.">Model allowlist</td>
        <td class="edit-cell">
          <input bind:value={draft.allowed_models} placeholder="unrestricted" />
          {#if draft.allowed_models !== system.settings.allowed_models.value.join(", ")}
            <Button size="sm" onclick={() => saveSetting("allowed_models", csv(draft.allowed_models))}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.allowed_models.source}">{system.settings.allowed_models.source}</span></td>
      </tr>
      <tr>
        <td>Organization name</td>
        <td class="edit-cell">
          <input bind:value={draft.org_name} />
          {#if draft.org_name !== (system.settings.org_name.value ?? "") && draft.org_name.trim()}
            <Button size="sm" onclick={() => saveSetting("org_name", draft.org_name.trim())}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.org_name.source}">{system.settings.org_name.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Total slots across running turns. Claude turn: 1 slot. Over cap: queued.">Chat slot cap</td>
        <td class="edit-cell">
          <input inputmode="numeric" bind:value={draft.agent_slot_cap} />
          {#if draft.agent_slot_cap !== String(system.settings.agent_slot_cap.value) && draft.agent_slot_cap !== ""}
            <Button size="sm" onclick={() => saveSetting("agent_slot_cap", Number(draft.agent_slot_cap))}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.agent_slot_cap.source}">{system.settings.agent_slot_cap.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Slots per Copilot turn.">Copilot turn weight</td>
        <td class="edit-cell">
          <input inputmode="numeric" bind:value={draft.copilot_slot_weight} />
          {#if draft.copilot_slot_weight !== String(system.settings.copilot_slot_weight.value) && draft.copilot_slot_weight !== ""}
            <Button size="sm" onclick={() => saveSetting("copilot_slot_weight", Number(draft.copilot_slot_weight))}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.copilot_slot_weight.source}">{system.settings.copilot_slot_weight.source}</span></td>
      </tr>
      <tr>
        <td class="tip" title="Max queued turns. Over max: busy.">Chat queue length</td>
        <td class="edit-cell">
          <input inputmode="numeric" bind:value={draft.agent_queue_max} />
          {#if draft.agent_queue_max !== String(system.settings.agent_queue_max.value) && draft.agent_queue_max !== ""}
            <Button size="sm" onclick={() => saveSetting("agent_queue_max", Number(draft.agent_queue_max))}>apply</Button>
          {/if}
        </td>
        <td><span class="badge src-{system.settings.agent_queue_max.source}">{system.settings.agent_queue_max.source}</span></td>
      </tr>
    </tbody>
  </table>

{/if}

<style>
  td .on { color: var(--ok); }
  td .state { display: inline-flex; align-items: center; gap: var(--pad-2); }
  .edit-cell input { min-width: 13rem; }
  label.check { display: flex; gap: 0.5rem; align-items: center; cursor: pointer; }
  .badge.src-db { border-color: var(--accent); color: var(--accent); }
  .badge.src-env { border-color: var(--warn); color: var(--warn); }
</style>
