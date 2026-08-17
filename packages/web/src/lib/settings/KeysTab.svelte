<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import { AGENT_KEY_LABELS } from "../admin/shared";
  import { Badge, Button, Note, Panel } from "../tui";

  type MyCreds = {
    vault_enabled: boolean;
    mine: { name: string; updated_at: string }[];
    effective: Record<string, "user" | "team" | "global" | "env" | null>;
  };

  let creds = $state<MyCreds | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let drafts = $state<Record<string, string>>({});

  const names = $derived(creds ? Object.keys(creds.effective) : []);
  const ordered = $derived([
    ...names.filter((n) => n in AGENT_KEY_LABELS),
    ...names.filter((n) => !(n in AGENT_KEY_LABELS)),
  ]);
  const mine = $derived(new Set(creds?.mine.map((m) => m.name) ?? []));

  async function load() {
    loading = true;
    error = null;
    try {
      creds = await api.get<MyCreds>("/me/credentials");
      drafts = {};
    } catch (e) {
      error = errText(e);
    } finally {
      loading = false;
    }
  }

  async function save(name: string) {
    const value = drafts[name]?.trim();
    if (!value) return;
    error = null;
    try {
      await api.put(`/me/credentials/${encodeURIComponent(name)}`, { value });
      await load();
    } catch (e) {
      error = errText(e);
    }
  }

  async function remove(name: string) {
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

<Panel title="my keys">
  <p class="lede">
    Stored encrypted; never shown again once saved. The active source is whichever
    scope currently wins for you.
  </p>

  {#if error}<Note tone="danger">{error}</Note>{/if}
  {#if loading && !creds}<p class="muted">loading…</p>{/if}

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
        <div class="row">
          <span class="k">{AGENT_KEY_LABELS[name] ?? name}</span>
          <span class="v">
            <input
              type="password"
              autocomplete="off"
              bind:value={drafts[name]}
              placeholder={mine.has(name)
                ? "(set — enter to replace)"
                : "(not set)"}
            />
            {#if drafts[name]?.trim()}
              <Button size="sm" onclick={() => save(name)}>save</Button>
            {/if}
          </span>
          <span class="s">
            <Badge tone={creds.effective[name] === "user" ? "accent" : "muted"}>
              {creds.effective[name] ?? "unset"}
            </Badge>
          </span>
          <span class="a">
            {#if mine.has(name)}
              <Button variant="ghost" size="sm" onclick={() => remove(name)}
                >remove</Button
              >
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</Panel>

<style>
  .lede {
    margin: 0 0 var(--pad-4);
    font-size: var(--fs-sm);
    color: var(--muted);
    max-width: 62ch;
  }
  .muted {
    color: var(--muted);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .row {
    display: grid;
    grid-template-columns: 14rem minmax(0, 1fr) 6rem 6rem;
    gap: var(--gap);
    align-items: center;
    min-height: var(--row-h);
  }
  .k {
    font-size: var(--fs-sm);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .v {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  .v input {
    flex: 1;
    min-width: 0;
  }
  .a {
    text-align: right;
  }
  code {
    background: var(--accent-dim);
    border-radius: var(--radius);
    padding: 0 0.3em;
  }
</style>
