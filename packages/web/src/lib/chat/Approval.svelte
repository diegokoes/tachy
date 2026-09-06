<script lang="ts">
  import type { Entry } from "../chatState.svelte";
  import { shatter } from "../motion";
  import { Button, Panel } from "../tui";
  import ApprovalField from "./ApprovalField.svelte";
  import { api } from "../api";
  import type { WorkItemSchema } from "../types";

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

  /* ---- work-item field schema -------------------------------------------
     create_ado_work_item takes an open `fields` object keyed by ADO reference
     names, so without a schema the box can only offer a JSON blob. Fetching the
     project's own schema turns it into real controls with the required fields
     marked. Best-effort by design: if the call is slow or fails, the JSON view
     below is what the user gets, because an approval that never renders blocks
     the turn. */
  let schema = $state<WorkItemSchema | null>(null);
  let schemaTried = $state(false);

  const isAdoCreate = $derived(entry.tool === "create_ado_work_item");
  const adoFields = $derived(
    isAdoCreate && entry.input.fields && typeof entry.input.fields === "object"
      ? (entry.input.fields as Record<string, unknown>)
      : null,
  );

  $effect(() => {
    if (!isAdoCreate || schemaTried || !pending) return;
    const input = entry.input as Record<string, unknown>;
    const source = input.source as string | undefined;
    const project = input.project as string | undefined;
    const type = input.type as string | undefined;
    if (!source || !project || !type) return;
    schemaTried = true;
    api
      .get<WorkItemSchema>(
        `/source-connections/${encodeURIComponent(source)}/work-item-schema` +
          `?project=${encodeURIComponent(project)}&type=${encodeURIComponent(type)}`,
      )
      .then((s) => (schema = s))
      .catch(() => (schema = null));
  });

  const specFor = (ref: string) =>
    schema?.fields.find((f) => f.reference_name === ref);

  /** Required fields the model did not fill — the commonest reason a create bounces. */
  const missing = $derived(
    schema && adoFields
      ? schema.fields
          .filter(
            (f) =>
              f.required &&
              !f.read_only &&
              (adoFields[f.reference_name] ?? "") === "" &&
              schema!.config_defaults[f.reference_name] === undefined,
          )
          .map((f) => f.name)
      : [],
  );

  function setField(ref: string, v: unknown) {
    set("fields", { ...(adoFields ?? {}), [ref]: v });
  }
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
          {#if key === "fields" && schema && adoFields}
            <!-- The one per-tool branch: ADO's own schema, when we have it. -->
            <div class="subfields">
              <span class="grouplabel">
                fields
                <span class="dim">{schema.type} · {schema.project}</span>
              </span>
              {#if missing.length}
                <p class="missing">
                  required and empty: {missing.join(", ")}
                </p>
              {/if}
              {#each schema.fields.filter((f) => !f.read_only && (f.required || f.reference_name in adoFields)) as f (f.reference_name)}
                <ApprovalField
                  name={f.reference_name}
                  spec={f}
                  value={adoFields[f.reference_name] ?? null}
                  onchange={(v) => setField(f.reference_name, v)}
                />
              {/each}
            </div>
          {:else}
            <ApprovalField
              name={key}
              value={entry.input[key]}
              onchange={(v) => set(key, v)}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if pending}
      {#if denying}
        <input
          class="reason"
          placeholder="why? (optional, the assistant reads this)"
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
  .subfields {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border-left: 2px solid var(--line, currentColor);
    padding-left: 0.6rem;
    margin: 0.2rem 0;
  }
  .grouplabel {
    opacity: 0.7;
    font-size: 0.85em;
  }
  .grouplabel .dim {
    opacity: 0.6;
    margin-left: 0.4rem;
  }
  .missing {
    margin: 0.1rem 0;
    font-size: 0.85em;
    color: var(--warn, orange);
  }
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
