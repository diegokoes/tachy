<script lang="ts">
  import {
    CLOUD_HINT,
    CLOUD_RE,
    MAX_ENTRY_TITLE_CHARS,
    RELATED_LINK_HINT,
    isRelatedLink,
    type PatternRow,
  } from "@tachy/contract";
  import { CONFIDENCES, RESOLUTION_CLARITIES } from "../vocab";
  import type { Snippet } from "svelte";
  import { Checkbox, Field, FormActions } from "../tui";
  import { onMount, untrack } from "svelte";
  import { api } from "../api";
  import { errText } from "../resource.svelte";
  import type { KnowledgeRow } from "./rows";
  import AsciiSelect from "../tui/AsciiSelect.svelte";
  import { t } from "../terms";
  import { csv } from "../tui/fields";
  import { setTopActions } from "../shell/subnav.svelte";
  import { Filing } from "../library/filing.svelte";

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

  const csvJoin = (v: string[] | null | undefined) => (v ?? []).join(", ");

  const seed = untrack(() => initial);

  let title = $state(seed.title ?? "");
  let issueSummary = $state(seed.issue_summary ?? "");
  let rootCause = $state(seed.root_cause ?? "");
  let resolution = $state(seed.resolution ?? "");
  let investigation = $state(seed.investigation ?? "");
  let symptoms = $state(csvJoin(seed.symptoms));
  let signals = $state(csvJoin(seed.signals));
  let tags = $state(csvJoin(seed.tags));
  let relatedLinks = $state(csvJoin(seed.related_links));
  const relatedLinkErr = $derived(
    csv(relatedLinks).every(isRelatedLink) ? null : RELATED_LINK_HINT,
  );
  let confidence = $state(seed.confidence ?? "");
  let cloud = $state(seed.cloud ?? "");
  // Same rule and wording as the API's zod schema, both from the contract, so
  // an invalid environment is caught in the field rather than on submit.
  const cloudErr = $derived(cloud && !CLOUD_RE.test(cloud) ? CLOUD_HINT : null);
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

  function buildPayload(): Record<string, unknown> {
    const blank = mode === "edit" ? null : undefined;
    const text = (v: string) => v.trim() || blank;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      issueSummary: text(issueSummary),
      rootCause: text(rootCause),
      resolution: text(resolution),
      investigation: text(investigation),
      symptoms: csv(symptoms),
      signals: csv(signals),
      tags: csv(tags),
      relatedLinks: csv(relatedLinks),
      confidence: confidence || (mode === "edit" ? null : undefined),
      cloud: cloud.trim() || (mode === "edit" ? null : undefined),
      resolutionClarity:
        resolutionClarity || (mode === "edit" ? null : undefined),
      // A checkbox is always a real answer, so it is sent either way - the
      // `|| null` the other optional fields use would drop an explicit false.
      hiddenFix,
      resolutionPattern:
        resolutionPattern || (mode === "edit" ? null : undefined),
      affectedVersion:
        affectedVersion.trim() || (mode === "edit" ? null : undefined),
      fixedVersion: fixedVersion.trim() || (mode === "edit" ? null : undefined),
      ...filing.payload(mode),
    };
    if (mode === "create") payload.status = status;
    return Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );
  }

  $effect(() => setTopActions(formActions));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    onSubmit(buildPayload());
  }
</script>

{#snippet formActions()}
  <FormActions
    form="entry-form"
    {saving}
    create={mode === "create"}
    oncancel={onCancel}
  />
{/snippet}

<form id="entry-form" class="entry-form" onsubmit={submit}>
  {#if extra}<div class="formbar">{@render extra()}</div>{/if}
  <Field
    label="title"
    required
    info="one line, at most {MAX_ENTRY_TITLE_CHARS} characters"
  >
    <input bind:value={title} maxlength={MAX_ENTRY_TITLE_CHARS} required />
  </Field>
  <Field label="issue summary" required>
    <textarea rows="3" bind:value={issueSummary} required></textarea>
  </Field>

  <Field label="root cause">
    <textarea rows="3" bind:value={rootCause}></textarea>
  </Field>
  <Field label="resolution">
    <textarea rows="3" bind:value={resolution}></textarea>
  </Field>
  <Field label="investigation">
    <textarea rows="3" bind:value={investigation}></textarea>
  </Field>

  <Field label="symptoms" info="comma-separated">
    <input bind:value={symptoms} />
  </Field>
  <Field label="signals" info="error codes and log patterns, comma-separated">
    <input bind:value={signals} />
  </Field>
  <Field label="tags" info="comma-separated">
    <input bind:value={tags} />
  </Field>
  <Field
    label="related links"
    info="full web addresses, comma-separated"
    error={relatedLinkErr ?? undefined}
  >
    <input bind:value={relatedLinks} />
  </Field>

  <div class="row">
    <Field label="confidence">
      <AsciiSelect
        bind:value={confidence}
        options={[{ value: "", label: "none" }, ...CONFIDENCES]}
      />
    </Field>
    <Field label="clarity">
      <AsciiSelect
        bind:value={resolutionClarity}
        options={[{ value: "", label: "none" }, ...RESOLUTION_CLARITIES]}
      />
    </Field>
    <Field label={t("cloud")} error={cloudErr ?? undefined}>
      <span class="short">
        <AsciiSelect
          bind:value={cloud}
          options={environments.map((environment) => environment.cloud)}
          creatable
          aria-label={t("cloud")}
        />
      </span>
    </Field>
  </div>

  <div class="row">
    <Field label="resolution pattern">
      <AsciiSelect
        bind:value={resolutionPattern}
        options={[
          { value: "", label: "none" },
          ...patterns.map((p) => p.slug as string),
        ]}
      />
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
        <AsciiSelect
          bind:value={filing.productSlug}
          options={filing.productOptions}
          onchange={() => filing.productChanged()}
        />
      </Field>
      <Field label="status">
        <AsciiSelect bind:value={status} options={["approved", "draft"]} />
      </Field>
    {/if}
    <Field label="component">
      <AsciiSelect
        bind:value={filing.component}
        disabled={!filing.productSlug || filing.components.length === 0}
        options={[{ value: "", label: "none" }, ...filing.componentChoices]}
      />
    </Field>
    <Field label={t("customer")}>
      <AsciiSelect
        bind:value={filing.customerSlug}
        options={filing.customerOptions}
        onchange={() => filing.customerChanged()}
      />
    </Field>
    <Field label="unit">
      <AsciiSelect
        bind:value={filing.unitSlug}
        options={filing.unitOptions}
        disabled={!filing.customerSlug || filing.units.length === 0}
      />
    </Field>
  </div>

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
  /* The entry page's reading width: a form as wide as the window strings
     short fields across a line the eye has to travel. */
  .entry-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    max-width: 48rem;
    margin-inline: auto;
  }
  input,
  textarea {
    font: inherit;
    color: var(--text);
  }
  textarea {
    resize: vertical;
  }
  .short {
    display: flex;
    max-width: 10rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-bottom: 0.4rem;
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .error {
    color: var(--danger);
    margin: 0;
  }
</style>
