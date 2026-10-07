<script lang="ts">
  import { onMount } from "svelte";
  import { AGENT_EFFORTS } from "@tachy/contract";
  import { Button, Note, Select } from "../tui";
  import {
    agentPrefs,
    loadAgent,
    origin,
    resetPref,
    setPref,
    type Pref,
  } from "./prefs.svelte";
  import Origin from "./Origin.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const prefs = $derived(agentPrefs.prefs);
  const modelList = $derived(agentPrefs.models);
  const listed = $derived(modelList?.models ?? []);

  const current = $derived(
    listed.find((m) => m.id === prefs?.agent_model.value),
  );

  // The stored model stays pickable when the runtime no longer offers it, so
  // the menu never shows a value other than the one turns use.
  const modelOptions = $derived.by(() => {
    const opts: { value: string; label: string; hint?: string }[] = listed.map(
      (m) => ({
        value: m.id,
        label: m.label,
        hint: m.id,
      }),
    );
    const id = prefs?.agent_model.value;
    if (id && !current)
      opts.unshift({
        value: id,
        label: id,
        ...(listed.length ? { hint: "not offered" } : {}),
      });
    return opts;
  });

  const efforts = $derived(current ? current.efforts : [...AGENT_EFFORTS]);
  const effortOptions = $derived.by(() => {
    const stored = prefs?.agent_effort.value;
    const opts: { value: string; label: string; hint?: string }[] = efforts.map(
      (e) => ({
        value: e,
        label: e,
      }),
    );
    if (stored && !efforts.includes(stored as (typeof efforts)[number]))
      opts.push({ value: stored, label: stored, hint: "not offered" });
    return opts;
  });

  // Typed by hand only when the runtime could not be asked: then there is no
  // list to pick from, and a model id is the one thing left to go on.
  const typed = $derived(Boolean(modelList && !modelList.models.length));
  let modelDraft = $state("");
  const draftChanged = $derived(
    Boolean(
      modelDraft.trim() && modelDraft.trim() !== prefs?.agent_model.value,
    ),
  );

  onMount(loadAgent);
</script>

{#snippet reset(key: string, pref: Pref<unknown>)}
  <span class="slot">
    {#if pref.source === "user"}
      <Button
        variant="ghost"
        square
        icon="reset"
        title="reset to the shared default"
        aria-label="reset {key}"
        onclick={() => resetPref(`agent_${key}`)}
      />
    {/if}
  </span>
{/snippet}

{#if agentPrefs.error}<Note tone="danger">{agentPrefs.error}</Note>{/if}
{#if agentPrefs.loading && !prefs}<p class="quiet">loading…</p>{/if}

{#if prefs}
  <Rows>
    <Row
      label="model"
      hint={modelList?.restricted ? "limited by your org" : undefined}
    >
      {#if typed}
        <input
          aria-label="model id"
          bind:value={modelDraft}
          placeholder={prefs.agent_model.value}
        />
      {:else}
        <Select
          aria-label="model"
          value={prefs.agent_model.value}
          options={modelOptions}
          searchable={modelOptions.length > 8}
          disabled={agentPrefs.modelsLoading && !listed.length}
          onchange={(v) => setPref("agent_model", v)}
        />
      {/if}
      {#snippet actions()}
        {#if typed && modelList?.error}
          <span class="warn">?</span>
        {/if}
        <Origin of={origin(prefs.agent_model.source, "default")} />
        {#if typed && draftChanged}
          <span class="slot">
            <Button
              variant="ghost"
              square
              tone="accent"
              icon="save"
              title="apply"
              aria-label="apply model"
              onclick={() => {
                setPref("agent_model", modelDraft.trim());
                modelDraft = "";
              }}
            />
          </span>
        {:else}
          {@render reset("model", prefs.agent_model)}
        {/if}
      {/snippet}
    </Row>

    <Row label="effort">
      {#if current && !current.efforts.length}
        <span class="fixed">fixed</span>
      {:else}
        <Select
          aria-label="effort"
          value={prefs.agent_effort.value}
          options={effortOptions}
          onchange={(v) => setPref("agent_effort", v)}
        />
      {/if}
      {#snippet actions()}
        <Origin of={origin(prefs.agent_effort.source, "default")} />
        {@render reset("effort", prefs.agent_effort)}
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
  /* The mark keeps its column whether or not there is a mark in it, so nothing
     reflows when a save swaps in for a reset mid-row. */
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--row-h);
  }
  .fixed {
    display: block;
    width: var(--control-w, 12rem);
    padding: 0 var(--pad-3);
    font-size: var(--fs-sm);
    color: var(--muted);
    cursor: help;
  }
  .warn {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--warn);
    cursor: help;
  }
</style>
