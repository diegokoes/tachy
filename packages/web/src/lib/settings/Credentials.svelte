<script lang="ts">
  import { AGENT_KEY_LABELS, agentKeyError } from "../credentials";
  import { API_KEY_EXAMPLE, OAUTH_PREFIX } from "@tachy/contract";
  import { Button, DeleteButton, InfoMark, Note, tip } from "../tui";
  import { agentPrefs, origin, removeKey, saveKey } from "./prefs.svelte";
  import Origin from "./Origin.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const creds = $derived(agentPrefs.creds);

  let drafts = $state<Record<string, string>>({});

  const keyLabel = (name: string) =>
    AGENT_KEY_LABELS[name] ?? name.split(":")[1] ?? name;

  const names = $derived(creds ? Object.keys(creds.effective) : []);
  const ordered = $derived([
    ...names.filter((n) => n in AGENT_KEY_LABELS),
    ...names.filter((n) => !(n in AGENT_KEY_LABELS)),
  ]);
  const mine = $derived(new Set(creds?.mine.map((m) => m.name) ?? []));

  async function save(name: string) {
    const value = drafts[name]?.trim();
    if (!value || agentKeyError(name, value)) return;
    await saveKey(name, value);
    drafts[name] = "";
  }
</script>

{#if creds && !creds.vault_enabled}
  <Note tone="warn">
    Credential storage disabled. Set <code>TACHY_SECRET_KEY</code> (32 bytes
    base64) for per-user keys. Until then: <code>.env</code>.
  </Note>
{:else if creds}
  <Rows>
    {#each ordered as name (name)}
      {@const draft = drafts[name]?.trim() ?? ""}
      {@const bad = draft ? agentKeyError(name, draft) : null}
      {@const from = creds.effective[name]}
      <Row label={keyLabel(name)}>
        <!-- A stored key is drawn as dots across the whole field rather than
             a short placeholder, so a filled field reads as filled at a glance. -->
        <div class="field">
          <input
            type="password"
            autocomplete="off"
            aria-label="{keyLabel(name)}{from ? ', set' : ''}"
            class:bad
            bind:value={drafts[name]}
            placeholder={from ? "" : "paste a key"}
          />
          {#if from && !draft}
            <span class="dots" class:shared={!mine.has(name)} aria-hidden="true"></span>
          {/if}
          <span class="end">
            {#if draft}
              <Button
                variant="ghost"
                square
                size="sm"
                tone={bad ? "danger" : "accent"}
                icon="save"
                disabled={Boolean(bad)}
                title={bad ?? "save"}
                aria-label={`save ${keyLabel(name)}`}
                onclick={() => save(name)}
              />
            {:else if mine.has(name)}
              <DeleteButton
                label={`remove ${keyLabel(name)}`}
                onclick={() => removeKey(name)}
              />
            {/if}
          </span>
        </div>
        {#snippet actions()}
          {#if creds.agent.in_use === name}
            <span class="live" use:tip={"chat turns answer with this key"}>in use</span>
          {/if}
          <Origin of={origin(from, "key")} />
          {#if name === "anthropic_oauth_token"}
            <InfoMark label="how to get a Claude subscription token">
              Run <code>claude setup-token</code> and paste the
              <code>{OAUTH_PREFIX}…</code> value it prints.
            </InfoMark>
          {:else if name === "anthropic_api_key"}
            <InfoMark label="what an Anthropic API key looks like">
              Starts with <code>{API_KEY_EXAMPLE}…</code>, from
              console.anthropic.com.
            </InfoMark>
          {/if}
        {/snippet}
      </Row>
    {/each}
  </Rows>
{/if}

<style>
  .field {
    position: relative;
    display: flex;
    align-items: center;
  }
  input {
    width: 100%;
    min-width: 0;
    padding-right: calc(var(--row-h) + var(--pad-1));
  }
  input.bad {
    border-color: var(--danger);
  }
  .dots {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--pad-3);
    right: calc(var(--row-h) + var(--pad-1));
    background: radial-gradient(circle, currentColor 0 0.2rem, transparent 0.23rem)
      left center / 0.85rem 100% repeat-x;
    color: var(--text);
    opacity: 0.7;
    pointer-events: none;
  }
  .dots.shared {
    opacity: 0.35;
  }
  input:focus + .dots {
    opacity: 0.2;
  }
  .end {
    position: absolute;
    right: 2px;
    display: flex;
    align-items: center;
  }
  .live {
    font-size: var(--fs-xs);
    color: var(--ok);
    white-space: nowrap;
    cursor: help;
  }
  code {
    background: var(--accent-dim);
    border-radius: var(--radius);
    padding: 0 0.3em;
  }
</style>
