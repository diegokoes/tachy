<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { decode } from "../motion";
  import { AGENT_KEY_LABELS, agentKeyError } from "../admin/shared";
  import { Button, InfoMark, Note, Panel, Select } from "../tui";

  type PrefSource = "user" | "team" | "db" | "env" | "default";
  type Pref<T> = { value: T; source: PrefSource };
  type Prefs = {
    agent_provider: Pref<"claude" | "copilot">;
    agent_model: Pref<string>;
    agent_effort: Pref<string>;
  };

  type KeyScope = "user" | "team" | "global" | "env";
  type MyCreds = {
    vault_enabled: boolean;
    mine: { name: string; updated_at: string }[];
    effective: Record<string, KeyScope | null>;
  };

  let prefs = $state<Prefs | null>(null);
  let creds = $state<MyCreds | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let modelDraft = $state("");
  let drafts = $state<Record<string, string>>({});

  const MASK = "••••••••••";

  /**
   * One sentence for every inherited value in this view, wherever it lands:
   * where it comes from, and that you can take it over. A value of your own
   * says nothing — the reset mark is the whole story.
   */
  const heldBy = (source: PrefSource | KeyScope | null) => {
    if (!source || source === "user") return "";
    return `${source === "db" ? "global" : source} · override`;
  };

  const keyLabel = (name: string) =>
    AGENT_KEY_LABELS[name] ?? name.split(":")[1] ?? name;

  const names = $derived(creds ? Object.keys(creds.effective) : []);
  const ordered = $derived([
    ...names.filter((n) => n in AGENT_KEY_LABELS),
    ...names.filter((n) => !(n in AGENT_KEY_LABELS)),
  ]);
  const mine = $derived(new Set(creds?.mine.map((m) => m.name) ?? []));
  const modelChanged = $derived(
    Boolean(
      modelDraft.trim() && modelDraft.trim() !== prefs?.agent_model.value,
    ),
  );

  async function load() {
    loading = true;
    error = null;
    try {
      const [p, c] = await Promise.all([
        api.get<Prefs>("/me/preferences"),
        api.get<MyCreds>("/me/credentials"),
      ]);
      prefs = p;
      creds = c;
      modelDraft = p.agent_model.source === "user" ? p.agent_model.value : "";
      drafts = {};
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
    const value = drafts[name]?.trim();
    if (!value || agentKeyError(name, value)) return;
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

<Panel title="agent">
  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if loading && !prefs}<p class="muted">loading…</p>{/if}

  {#if prefs}
    <div class="rows">
      <div class="row pref">
        <span class="k">provider</span>
        <span class="v">
          <Select
            value={prefs.agent_provider.value}
            options={[
              { value: "claude", label: "claude (Anthropic)" },
              { value: "copilot", label: "copilot (GitHub)" },
            ]}
            onchange={(v) => setPref("agent_provider", v)}
          />
        </span>
        <span class="a">
          <span class="from" use:decode={heldBy(prefs.agent_provider.source)}
          ></span>
          <span class="slot">
            {#if prefs.agent_provider.source === "user"}
              <Button
                variant="ghost"
                square
                tone="danger"
                icon="cancel"
                title="reset"
                aria-label="reset provider"
                onclick={() => resetPref("agent_provider")}
              />
            {/if}
          </span>
        </span>
      </div>

      <div class="row pref">
        <span class="k">model</span>
        <span class="v">
          <input bind:value={modelDraft} placeholder={prefs.agent_model.value} />
        </span>
        <span class="a">
          <span class="from" use:decode={heldBy(prefs.agent_model.source)}
          ></span>
          <span class="slot">
            {#if modelChanged}
              <Button
                variant="ghost"
                square
                tone="accent"
                icon="save"
                title="apply"
                aria-label="apply model"
                onclick={() => setPref("agent_model", modelDraft.trim())}
              />
            {:else if prefs.agent_model.source === "user"}
              <Button
                variant="ghost"
                square
                tone="danger"
                icon="cancel"
                title="reset"
                aria-label="reset model"
                onclick={() => resetPref("agent_model")}
              />
            {/if}
          </span>
        </span>
      </div>

      <div class="row pref">
        <span class="k">effort</span>
        <span class="v">
          <Select
            value={prefs.agent_effort.value}
            options={["low", "medium", "high", "xhigh", "max"]}
            onchange={(v) => setPref("agent_effort", v)}
          />
        </span>
        <span class="a">
          <span class="from" use:decode={heldBy(prefs.agent_effort.source)}
          ></span>
          <span class="slot">
            {#if prefs.agent_effort.source === "user"}
              <Button
                variant="ghost"
                square
                tone="danger"
                icon="cancel"
                title="reset"
                aria-label="reset effort"
                onclick={() => resetPref("agent_effort")}
              />
            {/if}
          </span>
        </span>
      </div>
    </div>
  {/if}
</Panel>

<div class="keys">
  <Panel title="keys">
    {#if creds && !creds.vault_enabled}
      <Note tone="warn">
        Credential storage is disabled on this server — set <code
          >TACHY_SECRET_KEY</code
        > (32 bytes base64) in the server environment to enable per-user keys. Until
        then keys come from <code>.env</code>.
      </Note>
    {:else if creds}
      <div class="rows">
        {#each ordered as name (name)}
          {@const draft = drafts[name]?.trim() ?? ""}
          {@const bad = draft ? agentKeyError(name, draft) : null}
          {@const from = creds.effective[name]}
          {@const held = heldBy(from)}
          <div class="row key">
            <span class="k">{keyLabel(name)}</span>
            <span class="v">
              <input
                type="password"
                autocomplete="off"
                class:bad
                bind:value={drafts[name]}
                placeholder={mine.has(name) ? MASK : ""}
                title={held ? `set at ${from} scope — type to override` : null}
                use:decode={held}
              />
            </span>
            <span class="a">
              <span class="slot">
                {#if name === "anthropic_oauth_token"}
                  <InfoMark label="how to get a Claude subscription token">
                    Run <code>claude setup-token</code> and paste the
                    <code>sk-ant-oat01-…</code> value it prints.
                  </InfoMark>
                {:else if name === "anthropic_api_key"}
                  <InfoMark label="what an Anthropic API key looks like">
                    Starts with <code>sk-ant-api03-…</code>, from
                    console.anthropic.com.
                  </InfoMark>
                {/if}
              </span>
              <span class="slot">
                {#if draft}
                  <Button
                    variant="ghost"
                    square
                    tone={bad ? "danger" : "accent"}
                    icon="save"
                    disabled={Boolean(bad)}
                    title={bad ?? "save"}
                    aria-label={`save ${keyLabel(name)}`}
                    onclick={() => saveKey(name)}
                  />
                {:else if mine.has(name)}
                  <Button
                    variant="ghost"
                    square
                    tone="danger"
                    icon="cancel"
                    title="remove"
                    aria-label={`remove ${keyLabel(name)}`}
                    onclick={() => removeKey(name)}
                  />
                {/if}
              </span>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Panel>
</div>

<style>
  .muted {
    color: var(--muted);
  }
  .keys {
    margin-top: var(--pad-4);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }

  /* Controls keep one width and the marks keep one column, so nothing reflows
     when a save swaps in for a reset mid-row. */
  .row {
    display: grid;
    gap: var(--gap);
    align-items: center;
    min-height: var(--row-h);
  }
  .row.pref {
    grid-template-columns: 7rem minmax(0, 16rem) 1fr;
  }
  .row.key {
    grid-template-columns: 14rem minmax(0, 24rem) 1fr;
  }
  .k {
    font-size: var(--fs-sm);
    color: var(--muted);
    letter-spacing: var(--label-spacing);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .v {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .v input {
    flex: 1;
    min-width: 0;
  }
  .v input.bad {
    border-color: var(--danger);
  }
  .a {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--pad-1);
  }
  .from {
    font-size: var(--fs-sm);
    color: var(--muted);
    white-space: nowrap;
  }
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--row-h);
  }
  code {
    background: var(--accent-dim);
    border-radius: var(--radius);
    padding: 0 0.3em;
  }
</style>
