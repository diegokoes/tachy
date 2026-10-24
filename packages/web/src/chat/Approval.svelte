<script lang="ts">
  import type { Entry } from "./chatState.svelte";
  import { shatter } from "../motion/motion";
  import { Button, Field, Panel } from "../tui";
  import ApprovalField from "./ApprovalField.svelte";
  import { api } from "../api";
  import { parseUploadRef, uploadPreviewPath } from "@tachy/contract";
  import type { WorkItemSchema } from "@tachy/contract";
  import { adoptAgentDraft } from "../work-items/composer.svelte";

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

  /** Collapsed summary once decided - the longest string field reads best. */
  const peek = $derived.by(() => {
    const longest = Object.values(entry.input)
      .filter((v): v is string => typeof v === "string")
      .sort((a, b) => b.length - a.length)[0];
    const flat = (longest ?? JSON.stringify(entry.input)).replace(/\s+/g, " ");
    return flat.length > 120 ? flat.slice(0, 120) + "…" : flat;
  });

  let raw = $state(false);

  // save_library_image keeps a picture: the review is of the picture, which
  // its fields only name. One taken out of a zip has no address to load.
  const previewSrc = $derived.by(() => {
    if (entry.tool !== "save_library_image" || entry.input.member) return null;
    const upload = parseUploadRef(String(entry.input.path ?? ""));
    return upload ? uploadPreviewPath(upload.id) : null;
  });

  // create_ado_work_item takes an open `fields` object, so the project's schema
  // turns a JSON blob into controls. A slow or failed call leaves the JSON
  // view: an approval that never renders blocks the turn.
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

  /** Required fields the model did not fill - the commonest reason a create bounces. */
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

  function setField(ref: string, value: unknown) {
    set("fields", { ...(adoFields ?? {}), [ref]: value });
  }
  let adopting = $state(false);
  let adoptNote = $state<string | null>(null);

  /** Finishing by hand in the composer ends this call; the model is told why. */
  async function toComposer() {
    adopting = true;
    adoptNote = null;
    try {
      if (await adoptAgentDraft(entry.input))
        ondecide(
          false,
          "The user moved this draft into the work item composer to finish and create it themselves. Do not retry or create it; acknowledge in one line.",
        );
      else
        adoptNote =
          "That project is not one of your team's registered projects, so the composer cannot take it.";
    } finally {
      adopting = false;
    }
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
        oninput={(e) => editRaw(e.currentTarget.value)}></textarea>
    {:else}
      {#if previewSrc}
        <img
          class="preview"
          src={previewSrc}
          alt={String(entry.input.alt ?? "the image to keep")}
        />
      {/if}
      <div class="fields">
        {#each keys as key (key)}
          {#if key === "fields" && schema && adoFields}
            <!-- The one per-tool branch: ADO's own schema, when there is
                 one. -->
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
              {#each schema.fields.filter((f) => !f.read_only && (f.required || f.reference_name in adoFields)) as field (field.reference_name)}
                <ApprovalField
                  name={field.reference_name}
                  spec={field}
                  value={adoFields[field.reference_name] ?? null}
                  onchange={(v) => setField(field.reference_name, v)}
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
        <div class="reason">
          <Field label="reason" info="optional; the assistant reads it">
            <input
              bind:value={reason}
              onkeydown={(e) => {
                if (e.key === "Enter")
                  ondecide(false, reason.trim() || undefined);
                if (e.key === "Escape") denying = false;
              }}
            />
          </Field>
        </div>
      {/if}
      {#if adoptNote}<p class="missing">{adoptNote}</p>{/if}
      <div class="acts">
        {#if isAdoCreate}
          <Button
            variant="ghost"
            size="sm"
            icon="edit"
            busy={adopting}
            onclick={toComposer}>open in composer</Button
          >
        {/if}
        <Button
          variant="ghost"
          size="sm"
          square
          icon="json"
          aria-pressed={raw}
          title={raw ? "back to fields" : "raw input"}
          onclick={toggleRaw}
        />
        <Button
          variant="ghost"
          tone="ok"
          icon="approve"
          disabled={rawBad}
          onclick={() => ondecide(true)}
          >{rawBad ? "fix the JSON first" : "approve"}</Button
        >
        <Button variant="ghost" tone="danger" icon="reject" onclick={deny}
          >{denying ? "confirm deny" : "deny"}</Button
        >
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

  .preview {
    display: block;
    max-width: 100%;
    max-height: 18rem;
    margin-bottom: var(--pad-3);
    border: 1px solid var(--line, currentColor);
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
    margin-top: var(--pad-3);
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
