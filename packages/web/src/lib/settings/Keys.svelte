<script lang="ts">
  import { AGENT_KEY_LABELS, agentKeyError } from "../credentials";
  import { API_KEY_EXAMPLE, OAUTH_PREFIX } from "@tachy/contract";
  import { Button, InfoMark, Note } from "../tui";
  import { agentPrefs, heldBy, removeKey, saveKey } from "./prefs.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const creds = $derived(agentPrefs.creds);

  const MASK = "••••••••••";

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
    Credential storage is disabled on this server. Set <code
      >TACHY_SECRET_KEY</code
    > (32 bytes base64) in the server environment to enable per-user keys. Until then
    keys come from <code>.env</code>.
  </Note>
{:else if creds}
  <Rows>
    {#each ordered as name (name)}
      {@const draft = drafts[name]?.trim() ?? ""}
      {@const bad = draft ? agentKeyError(name, draft) : null}
      {@const from = creds.effective[name]}
      {@const held = heldBy(from)}
      <Row label={keyLabel(name)}>
        <input
          type="password"
          autocomplete="off"
          class:bad
          bind:value={drafts[name]}
          placeholder={held || (mine.has(name) ? MASK : "")}
          title={held ? `set at ${from} scope, type to override` : null}
        />
        {#snippet actions()}
          <span class="slot">
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
                onclick={() => save(name)}
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
        {/snippet}
      </Row>
    {/each}
  </Rows>
{/if}

<style>
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--row-h);
  }
  input {
    width: 100%;
    min-width: 0;
  }
  input.bad {
    border-color: var(--danger);
  }
  code {
    background: var(--accent-dim);
    border-radius: var(--radius);
    padding: 0 0.3em;
  }
</style>
