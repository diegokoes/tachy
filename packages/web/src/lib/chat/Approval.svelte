<script lang="ts">
  import type { Entry } from "../chatState.svelte";
  import { shatter } from "../motion";
  import { Button, Panel } from "../tui";
  import ApprovalField from "./ApprovalField.svelte";

  type Approval = Extract<Entry, { kind: "approval" }>;

  let {
    entry,
    ondecide,
  }: {
    entry: Approval;
    /** `reason` travels to the model as the denial message. */
    ondecide: (approve: boolean, reason?: string) => void;
  } = $props();

  const pending = $derived(entry.status === "pending");
  const keys = $derived(Object.keys(entry.input));

  /** Collapsed summary once decided — the longest string field reads best. */
  const peek = $derived.by(() => {
    const s = Object.values(entry.input)
      .filter((v): v is string => typeof v === "string")
      .sort((a, b) => b.length - a.length)[0];
    const t = (s ?? JSON.stringify(entry.input)).replace(/\s+/g, " ");
    return t.length > 120 ? t.slice(0, 120) + "…" : t;
  });

  let raw = $state(false);
  let rawBad = $state(false);
  let denying = $state(false);
  let reason = $state("");

  function editRaw(text: string) {
    entry.raw = text;
    try {
      entry.input = JSON.parse(text) as Record<string, unknown>;
      rawBad = false;
    } catch {
      rawBad = true;
    }
  }

  function toggleRaw() {
    raw = !raw;
    if (raw) {
      entry.raw = JSON.stringify(entry.input, null, 2);
      rawBad = false;
    } else {
      entry.raw = undefined;
    }
  }

  function set(key: string, value: unknown) {
    entry.input = { ...entry.input, [key]: value };
  }

  function deny() {
    if (!denying) {
      denying = true;
      return;
    }
    ondecide(false, reason.trim() || undefined);
  }
</script>

<div class="wrap">
  <Panel
    title={entry.tool}
    tone={entry.status === "denied"
      ? "danger"
      : entry.status === "approved"
        ? "accent"
        : "warn"}
  >
    {#snippet meta()}
      <span>{pending ? "review" : entry.status}</span>
    {/snippet}

    {#if !pending}
      {#if entry.status === "denied"}
        <pre class="peek" use:shatter>{peek}</pre>
      {:else}
        <p class="peek">{peek}</p>
      {/if}
    {:else if raw}
      <textarea
        class="raw"
        class:bad={rawBad}
        value={entry.raw ?? ""}
        spellcheck="false"
        aria-label="raw tool input"
        oninput={(e) => editRaw(e.currentTarget.value)}
      ></textarea>
    {:else}
      <div class="fields">
        {#each keys as key (key)}
          <ApprovalField
            name={key}
            value={entry.input[key]}
            onchange={(v) => set(key, v)}
          />
        {/each}
      </div>
    {/if}

    {#if pending}
      {#if denying}
        <input
          class="reason"
          placeholder="why? (optional — the assistant reads this)"
          bind:value={reason}
          onkeydown={(e) => {
            if (e.key === "Enter") ondecide(false, reason.trim() || undefined);
            if (e.key === "Escape") denying = false;
          }}
        />
      {/if}
      <div class="acts">
        <Button
          variant="ghost"
          size="sm"
          title={raw ? "back to fields" : "edit raw JSON"}
          aria-label={raw ? "back to fields" : "edit raw JSON"}
          onclick={toggleRaw}>{raw ? "fields" : "{ }"}</Button
        >
        <Button
          variant="ghost"
          square
          tone="ok"
          icon="check"
          disabled={rawBad}
          title={rawBad ? "fix the JSON first" : "approve"}
          aria-label="approve"
          onclick={() => ondecide(true)}
        />
        <Button
          variant="ghost"
          square
          tone="danger"
          icon="cancel"
          title={denying ? "confirm deny" : "deny"}
          aria-label="deny"
          onclick={deny}
        />
      </div>
    {/if}
  </Panel>
</div>

<style>
  .wrap {
    max-width: 46rem;
    margin: var(--pad-2) 0;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }

  .peek {
    margin: 0;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .raw {
    width: 100%;
    min-height: 16rem;
    max-height: 55vh;
    resize: vertical;
    font: inherit;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .raw.bad {
    border-color: var(--danger);
  }

  .reason {
    width: 100%;
    margin-top: var(--pad-3);
    font: inherit;
    font-size: var(--fs-sm);
  }

  .acts {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--pad-2);
    margin-top: var(--pad-3);
  }
</style>
