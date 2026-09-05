<script lang="ts">
  import {
    AGENT_CREDENTIALS,
    ANTHROPIC_OAUTH_CREDENTIAL,
    validateCredential,
  } from "@tachy/contract";
  import { onMount } from "svelte";
  import { api } from "../api";
  import { session } from "../session.svelte";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { errText } from "../resource.svelte";
  import { AGENT_KEY_LABELS, type Team, type Connection } from "./shared";

  type CredList = {
    vault_enabled: boolean;
    credentials: { name: string; updated_at: string }[];
  };

  const isGlobalAdmin = $derived(session.me?.role === "admin" || !session.me);

  let teams = $state<Team[]>([]);
  let connections = $state<Connection[]>([]);
  let list = $state<CredList | null>(null);
  let error = $state<string | null>(null);

  let target = $state<string>("global");
  let drafts = $state<Record<string, string>>({});

  /*
   * From the contract's own list rather than retyped, and including the Claude
   * subscription token — which was missing, so it could not be set at global or
   * team scope from here at all, even though the wizard tells the operator that
   * is where it saved one.
   */
  const knownNames = $derived([
    ...Object.values(AGENT_CREDENTIALS),
    ANTHROPIC_OAUTH_CREDENTIAL,
    ...connections.map((s) => `${s.source_type}_token:${s.slug}`),
  ]);
  const setNames = $derived(new Set(list?.credentials.map((c) => c.name) ?? []));

  const scopeQuery = $derived(
    target === "global" ? "scope=global" : `scope=team&team=${encodeURIComponent(target)}`,
  );

  const targetOptions = $derived([
    ...(isGlobalAdmin ? [{ value: "global", label: "global (everyone)" }] : []),
    ...(isGlobalAdmin
      ? teams.map((t) => ({ value: t.slug, label: `team ${t.slug}` }))
      : (session.me?.team_admin ?? []).map((t) => ({ value: t.team_slug, label: `team ${t.team_slug}` }))),
  ]);

  async function load() {
    error = null;
    try {
      if (!targetOptions.some((o) => o.value === target))
        target = targetOptions[0]?.value ?? "global";
      [list, connections] = await Promise.all([
        api.get<CredList>(`/credentials?${scopeQuery}`),
        api.get<Connection[]>("/source-connections"),
      ]);
      if (isGlobalAdmin) teams = await api.get<Team[]>("/teams");
      drafts = {};
    } catch (e) {
      error = errText(e);
    }
  }

  function body(name: string) {
    return target === "global"
      ? { scope: "global", name }
      : { scope: "team", team: target, name };
  }

  // The same check the vault runs on the way in, so a typo is caught in the
  // field it was typed into rather than coming back as a server error.
  const draftError = (name: string) =>
    drafts[name]?.trim() ? validateCredential(name, drafts[name].trim()) : null;

  async function save(name: string) {
    const value = drafts[name]?.trim();
    if (!value) return;
    const invalid = validateCredential(name, value);
    if (invalid) {
      error = invalid;
      return;
    }
    error = null;
    try {
      await api.put("/credentials", { ...body(name), value });
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function remove(name: string) {
    error = null;
    try {
      await api.delete("/credentials", body(name));
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  onMount(load);
</script>

<div class="cred-panel">
  {#if error}<p class="error">{error}</p>{/if}

  <div class="scope-row">
    <span class="muted">scope</span>
    <AsciiSelect value={target} options={targetOptions} onchange={(v) => { target = String(v); load(); }} />
  </div>

  {#if list && !list.vault_enabled}
    <p class="muted">Credential storage is disabled. Set <code>TACHY_SECRET_KEY</code>
      (32 bytes base64, e.g. <code>openssl rand -base64 32</code>) in the server
      environment and restart. Until then keys come from <code>.env</code>.</p>
  {:else if list}
    <table>
      <thead><tr><th>credential</th><th>value</th><th>status</th><th></th></tr></thead>
      <tbody>
        {#each knownNames as name (name)}
          <tr>
            <td>{AGENT_KEY_LABELS[name] ?? name}</td>
            <td class="edit-cell">
              <input type="password" bind:value={drafts[name]}
                placeholder={setNames.has(name) ? "(set, enter to replace)" : "(not set)"} autocomplete="off" />
              {#if drafts[name]?.trim()}
                {@const bad = draftError(name)}
                <button class="mini" disabled={!!bad} onclick={() => save(name)}>save</button>
                {#if bad}<p class="field-error">{bad}</p>{/if}
              {/if}
            </td>
            <td><span class="badge" class:on={setNames.has(name)}>{setNames.has(name) ? "set" : "unset"}</span></td>
            <td>{#if setNames.has(name)}<button class="mini ghost" onclick={() => remove(name)}>remove</button>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .cred-panel { display: flex; flex-direction: column; gap: 0.75rem; }
  .muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
  .error { color: var(--danger); margin: 0; }
  .field-error { color: var(--danger); margin: 0.2rem 0 0; font-size: 0.9em; }
  .scope-row { display: flex; gap: 0.6rem; align-items: center; }
  .edit-cell input { min-width: 16rem; }
  code { background: var(--accent-dim); border-radius: 3px; padding: 0 0.3em; font-size: 0.92em; }
</style>
