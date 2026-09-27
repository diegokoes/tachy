<script lang="ts">
  import { CLOUD_HINT, CLOUD_RE, type PatternRow } from "@tachy/contract";
  import { CONFIDENCES, RESOLUTION_CLARITIES } from "../vocab";
  import type { Snippet } from "svelte";
  import { Checkbox, Field, FormActions } from "../tui";
  import { onMount, tick, untrack } from "svelte";
  import { gsap } from "../gsap";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import type { KnowledgeRow } from "../types";
  import AsciiSelect from "../AsciiSelect.svelte";
  import { t } from "../terms";
  import { csv } from "../fields";
  import { setTopActions } from "../subnav.svelte";
  import { Filing } from "../filing.svelte";
  import Icon from "../tui/Icon.svelte";
  import { asStructured } from "./structured";

  let {
    mode,
    initial = {},
    saving = false,
    error = null,
    onSubmit,
    onCancel,
    extra,
  }: {
    mode: "create" | "edit";
    initial?: Partial<KnowledgeRow>;
    saving?: boolean;
    error?: string | null;
    onSubmit: (payload: Record<string, unknown>) => void;
    onCancel: () => void;
    extra?: Snippet;
  } = $props();

  const SUBMIT_LABEL = $derived(mode === "create" ? "create entry" : "save changes");

  const csvJoin = (v: string[] | null | undefined) => (v ?? []).join(", ");

  const seed = untrack(() => initial);

  let issueSummary = $state(seed.issue_summary ?? "");
  let rootCause = $state(seed.root_cause ?? "");
  let resolution = $state(seed.resolution ?? "");
  let symptoms = $state(csvJoin(seed.symptoms));
  let signals = $state(csvJoin(seed.signals));
  let tags = $state(csvJoin(seed.tags));
  let confidence = $state(seed.confidence ?? "");
  let cloud = $state(seed.cloud ?? "");
  // Same rule and wording as the API's zod schema, both from the contract, so
  // an invalid environment is caught in the field rather than on submit.
  const cloudErr = $derived(
    cloud && !CLOUD_RE.test(cloud) ? CLOUD_HINT : null,
  );
  let resolutionClarity = $state(seed.resolution_clarity ?? "");
  let hiddenFix = $state(Boolean(seed.hidden_fix));
  let resolutionPattern = $state(seed.resolution_pattern ?? "");
  let affectedVersion = $state(seed.affected_version ?? "");
  let fixedVersion = $state(seed.fixed_version ?? "");
  let status = $state(seed.status ?? "approved");
  const filing = new Filing({
    ...seed,
    product_id: untrack(() => mode) === "edit" ? seed.product_id : null,
  });

  let showStructured = $state(false);
  let structuredField = $state<HTMLTextAreaElement>();
  let structuredText = $state(
    Object.keys(asStructured(seed.structured)).length
      ? JSON.stringify(asStructured(seed.structured), null, 2)
      : "",
  );
  let structuredError = $state<string | null>(null);

  let patterns = $state<PatternRow[]>([]);
  let environments = $state<{ cloud: string; count: number }[]>([]);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    try {
      [patterns, environments] = await Promise.all([
        api.get<PatternRow[]>("/resolution-patterns"),
        api.get<{ cloud: string; count: number }[]>("/knowledge/environments"),
        filing.load(),
      ]);
    } catch (e) {
      loadError = errText(e);
    }
  });

  function buildPayload(): Record<string, unknown> | null {
    structuredError = null;
    let structured: Record<string, unknown> | undefined;
    if (structuredText.trim()) {
      try {
        structured = JSON.parse(structuredText);
      } catch (e) {
        structuredError = `invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
        return null;
      }
    }
    const text = (v: string) => (v.trim() ? v.trim() : mode === "edit" ? null : undefined);
    const payload: Record<string, unknown> = {
      issueSummary: text(issueSummary),
      rootCause: text(rootCause),
      resolution: text(resolution),
      symptoms: csv(symptoms),
      signals: csv(signals),
      tags: csv(tags),
      confidence: confidence || (mode === "edit" ? null : undefined),
      cloud: cloud.trim() || (mode === "edit" ? null : undefined),
      resolutionClarity: resolutionClarity || (mode === "edit" ? null : undefined),
      // A checkbox is always a real answer, so it is sent either way — the
      // `|| null` the other optional fields use would drop an explicit false.
      hiddenFix,
      resolutionPattern: resolutionPattern || (mode === "edit" ? null : undefined),
      affectedVersion: affectedVersion.trim() || (mode === "edit" ? null : undefined),
      fixedVersion: fixedVersion.trim() || (mode === "edit" ? null : undefined),
      ...filing.payload(mode),
    };
    if (structured !== undefined) payload.structured = structured;
    if (mode === "create") payload.status = status;
    return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
  }

  $effect(() => setTopActions(formActions));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (payload) onSubmit(payload);
  }

  async function toggleStructured() {
    showStructured = !showStructured;
    if (!showStructured) return;
    await tick();
    if (!structuredField) return;
    resizeStructured();
    const container = structuredField.closest("main") as HTMLElement | null;
    if (!container) return;
    const target =
      container.scrollTop +
      structuredField.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    gsap.to(container, {
      scrollTop: target,
      duration: 0.82,
      ease: "power3.inOut",
      overwrite: "auto",
    });
  }

  function resizeStructured() {
    if (!structuredField) return;
    structuredField.style.height = "auto";
    structuredField.style.height = `${Math.max(structuredField.scrollHeight, 320)}px`;
  }
</script>

{#snippet formActions()}
  <FormActions form="entry-form" {saving} title={SUBMIT_LABEL} create={mode === "create"} oncancel={onCancel} />
{/snippet}

<form id="entry-form" class="entry-form" onsubmit={submit}>
  {#if extra}<div class="formbar">{@render extra()}</div>{/if}
  <Field label="issue summary" required>
    <input bind:value={issueSummary} required />
  </Field>

  <Field label="root cause">
    <textarea rows="3" bind:value={rootCause}></textarea>
  </Field>
  <Field label="resolution">
    <textarea rows="3" bind:value={resolution}></textarea>
  </Field>

  <Field label="symptoms" info="Comma-separated.">
    <input bind:value={symptoms} />
  </Field>
  <Field label="signals" info="Error codes and log patterns, comma-separated.">
    <input bind:value={signals} />
  </Field>
  <Field label="tags" info="Comma-separated.">
    <input bind:value={tags} />
  </Field>

  <div class="row">
    <Field label="confidence">
      <AsciiSelect bind:value={confidence} options={[{ value: "", label: "unset" }, ...CONFIDENCES]} />
    </Field>
    <Field label="clarity">
      <AsciiSelect bind:value={resolutionClarity} options={[{ value: "", label: "unset" }, ...RESOLUTION_CLARITIES]} />
    </Field>
    <Field label={t("cloud")} error={cloudErr ?? undefined}>
      <input class="short" bind:value={cloud} list="entry-form-envs"
        aria-invalid={cloudErr ? "true" : undefined} />
      <datalist id="entry-form-envs">
        {#each environments as e}<option value={e.cloud}></option>{/each}
      </datalist>
    </Field>
  </div>

  <div class="row">
    <Field label="resolution pattern">
      <AsciiSelect bind:value={resolutionPattern}
        options={[{ value: "", label: "none" }, ...patterns.map((p) => p.slug as string)]} />
    </Field>
    <Field label="affected version">
      <input class="short" bind:value={affectedVersion} />
    </Field>
    <Field label="fixed version">
      <input class="short" bind:value={fixedVersion} />
    </Field>
    <label class="check">
      <Checkbox bind:checked={hiddenFix} ariaLabel="hidden fix" /> hidden fix
    </label>
  </div>

  <div class="row">
    {#if mode === "create"}
      <Field label={t("product")}>
        <AsciiSelect bind:value={filing.productSlug} options={filing.productOptions}
          onchange={() => filing.productChanged()} />
      </Field>
      <Field label="status">
        <AsciiSelect bind:value={status} options={["approved", "draft"]} />
      </Field>
    {/if}
    <Field label="component">
      <AsciiSelect bind:value={filing.component}
        disabled={!filing.productSlug || filing.components.length === 0}
        title={filing.productSlug ? undefined : `pick a ${t("product")} first`}
        options={[{ value: "", label: "none" }, ...filing.componentChoices]} />
    </Field>
    <Field label={t("customer")}>
      <AsciiSelect bind:value={filing.customerSlug} options={filing.customerOptions}
        onchange={() => filing.customerChanged()}
        title="customer this applies to; none if general" />
    </Field>
    <Field label="unit">
      <AsciiSelect bind:value={filing.unitSlug} options={filing.unitOptions}
        disabled={!filing.customerSlug || filing.units.length === 0}
        title={filing.customerSlug
          ? "which part of their estate: a site or line"
          : `pick a ${t("customer")} first`} />
    </Field>
  </div>

  <button
    type="button"
    class="json-toggle"
    aria-label={showStructured ? "Hide structured JSON" : "Show structured JSON"}
    title={showStructured ? "Hide structured JSON" : "Show structured JSON"}
    onclick={() => void toggleStructured()}
  >
    <Icon name="json" size="1.8rem" />
  </button>
  {#if showStructured}
    <textarea
      bind:this={structuredField}
      class="structured"
      rows="16"
      bind:value={structuredText}
      aria-label="structured JSON"
      spellcheck="false"
      oninput={resizeStructured}
    ></textarea>
    {#if structuredError}<p class="error">{structuredError}</p>{/if}
  {/if}

  {#if error ?? loadError ?? filing.error}
    <p class="error">{error ?? loadError ?? filing.error}</p>
  {/if}

</form>

<style>
  /* Holds only what the caller passes as `extra`, centred; absent when there
     is none. */
  .formbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pad-2);
    margin-bottom: var(--pad-3);
    padding-bottom: var(--pad-2);
    border-bottom: var(--panel-line);
  }
  .entry-form { display: flex; flex-direction: column; gap: 0.6rem; }
  input, textarea { font: inherit; color: var(--text); }
  textarea { resize: vertical; }
  .short { max-width: 10rem; }
  .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .check { display: flex; align-items: center; gap: 0.4rem; padding-bottom: 0.4rem; font-size: var(--fs-sm); color: var(--muted); }
  .structured { width: 100%; min-height: 20rem; height: 20rem; box-sizing: border-box; overflow: hidden; resize: none; color: #e2e2e2; background: #000; font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.5; }
  :global(:root[data-theme="light"]) .structured { color: #000; background: #fff; }
  .json-toggle { align-self: center; display: grid; place-items: center; color: var(--text); background: transparent; border: 0; padding: 0.25rem; cursor: pointer; }
  .json-toggle:hover :global(svg) { stroke-width: var(--sw-hover, 9); }
  .error { color: var(--danger); margin: 0; }
</style>
