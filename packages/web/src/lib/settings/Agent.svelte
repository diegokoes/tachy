<script lang="ts">
  import { onMount } from "svelte";
  import { PROVIDER_OPTIONS } from "../vocab";
  import { AGENT_EFFORTS } from "@tachy/contract";
  import { Button, Note, Select } from "../tui";
  import {
    agentPrefs,
    heldBy,
    loadAgent,
    resetPref,
    setPref,
  } from "./prefs.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const prefs = $derived(agentPrefs.prefs);

  let modelDraft = $state("");
  let touched = $state(false);

  /* The draft follows the stored value until the reader types, and then stops:
     a reload triggered by saving the effort must not wipe a half-typed model. */
  $effect(() => {
    const p = agentPrefs.prefs;
    if (!p || touched) return;
    modelDraft = p.agent_model.source === "user" ? p.agent_model.value : "";
  });

  const modelChanged = $derived(
    Boolean(modelDraft.trim() && modelDraft.trim() !== prefs?.agent_model.value),
  );

  onMount(loadAgent);
</script>

{#if agentPrefs.error}<Note tone="danger">{agentPrefs.error}</Note>{/if}
{#if agentPrefs.loading && !prefs}<p class="quiet">loading…</p>{/if}

{#if prefs}
  <Rows>
    <Row label="provider">
      <Select
        value={prefs.agent_provider.value}
        options={PROVIDER_OPTIONS}
        onchange={(v) => setPref("agent_provider", v)}
      />
      {#snippet actions()}
        <span class="from">{heldBy(prefs.agent_provider.source)}</span>
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
      {/snippet}
    </Row>

    <Row label="model">
      <input
        bind:value={modelDraft}
        oninput={() => (touched = true)}
        placeholder={prefs.agent_model.value}
      />
      {#snippet actions()}
        <span class="from">{heldBy(prefs.agent_model.source)}</span>
        <span class="slot">
          {#if modelChanged}
            <Button
              variant="ghost"
              square
              tone="accent"
              icon="save"
              title="apply"
              aria-label="apply model"
              onclick={() => {
                touched = false;
                setPref("agent_model", modelDraft.trim());
              }}
            />
          {:else if prefs.agent_model.source === "user"}
            <Button
              variant="ghost"
              square
              tone="danger"
              icon="cancel"
              title="reset"
              aria-label="reset model"
              onclick={() => {
                touched = false;
                resetPref("agent_model");
              }}
            />
          {/if}
        </span>
      {/snippet}
    </Row>

    <Row label="effort">
      <Select
        value={prefs.agent_effort.value}
        options={[...AGENT_EFFORTS]}
        onchange={(v) => setPref("agent_effort", v)}
      />
      {#snippet actions()}
        <span class="from">{heldBy(prefs.agent_effort.source)}</span>
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
      {/snippet}
    </Row>
  </Rows>
{/if}

<style>
  .quiet {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .from {
    font-size: var(--fs-sm);
    color: var(--muted);
    white-space: nowrap;
  }
  /* The mark keeps its column whether or not there is a mark in it, so nothing
     reflows when a save swaps in for a reset mid-row. */
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
</style>
