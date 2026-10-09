<script lang="ts">
  import { onMount } from "svelte";
  import type { ApiTokenRow } from "@tachy/contract";
  import { api } from "../api";
  import { fmtDate } from "../dates.svelte";
  import { Button, DeleteButton, Note } from "../tui";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";
  import { tokenState } from "./tokens";

  let tokens = $state<ApiTokenRow[]>([]);
  let name = $state("");
  // The one moment a token exists in the clear: the answer to minting it.
  let issued = $state<{ name: string; token: string } | null>(null);
  let copied = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const live = $derived(tokens.filter((t) => tokenState(t) === "active"));

  async function attempt(action: () => Promise<void>) {
    busy = true;
    error = null;
    try {
      await action();
      tokens = await api.get<ApiTokenRow[]>("/me/tokens");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const mint = () =>
    attempt(async () => {
      const made = await api.post<ApiTokenRow & { token: string }>(
        "/me/tokens",
        { name: name.trim() },
      );
      issued = { name: made.name, token: made.token };
      name = "";
    });

  const revoke = (token: ApiTokenRow) =>
    attempt(async () => {
      await api.delete(`/me/tokens/${token.id}`);
    });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      copied = false;
    }
  }

  onMount(() => void attempt(async () => {}));
</script>

{#if error}<Note tone="danger">{error}</Note>{/if}

{#if issued}
  <Note tone="warn">
    Copy the token for {issued.name} now. It won't be shown again.
  </Note>
  <div class="secret">
    <code>{issued.token}</code>
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? "confirm" : "copy"}
      title="copy the token"
      onclick={() => issued && copy(issued.token)}
    />
  </div>
{/if}

<Rows>
  {#each live as token (token.id)}
    <Row
      label={token.name}
      hint={token.last_used_at
        ? `ends in ${token.hint} · last used ${fmtDate(token.last_used_at)}`
        : `ends in ${token.hint} · never used`}
    >
      <DeleteButton
        label={`revoke ${token.name}`}
        text="revoke"
        onclick={() => revoke(token)}
      />
    </Row>
  {/each}
  <Row label="new token" hint="Acts as you, with your rights, until revoked.">
    <div class="field">
      <input
        aria-label="token name"
        placeholder="what it is for"
        maxlength="100"
        bind:value={name}
      />
      <Button
        variant="ghost"
        size="sm"
        icon="plus"
        tone="ok"
        {busy}
        disabled={!name.trim()}
        onclick={mint}>create</Button
      >
    </div>
  </Row>
</Rows>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .secret {
    display: flex;
    align-items: flex-start;
    gap: var(--pad-2);
    margin: var(--pad-2) 0;
  }
  .secret code {
    flex: 1;
    min-width: 0;
    padding: var(--pad-2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    border: 1px dashed var(--border);
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
