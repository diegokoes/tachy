<script lang="ts">
  import type { PatternRow } from "@tachy/contract";
  import { Meter, Select } from "../tui";
  import { CONFIDENCES, RESOLUTION_CLARITIES } from "../vocab";
  import { showCustomer, t } from "../terms";
  import type { Filing } from "../library/filing.svelte";
  import type { DraftField, DraftProblems, EntryDraft } from "./draft";
  import { qualityMeter } from "./quality";
  import type { KnowledgeRow } from "./rows";

  let {
    draft = $bindable(),
    unsaved,
    canEdit,
    creating,
    filing,
    patterns,
    environments,
    entry,
    problems,
  }: {
    draft: EntryDraft;
    /** Fields holding an unsaved edit, drawn in the accent. */
    unsaved: ReadonlySet<DraftField>;
    canEdit: boolean;
    /** Offers the product as well, which only a new entry can choose. */
    creating: boolean;
    filing: Filing;
    patterns: PatternRow[];
    environments: { cloud: string; count: number }[];
    /** The saved entry, for its source work item; null while creating. */
    entry: KnowledgeRow | null;
    problems: DraftProblems;
  } = $props();

  const NONE = { value: "", label: "none" };
  const YES_NO = ["yes", "no"];

  const productOptions = $derived(
    filing.productOptions.map((option) =>
      option.value
        ? { value: option.value, label: option.value, hint: option.label }
        : NONE,
    ),
  );
  const customerOptions = $derived([
    NONE,
    ...filing.customers.map((c) => ({
      value: c.slug,
      label: c.slug,
      hint: c.name,
    })),
  ]);
  const unitOptions = $derived([
    { value: "", label: "the whole account" },
    ...filing.units.map((u) => ({
      value: u.slug,
      label: u.slug,
      hint: `${u.name} (${u.kind})`,
    })),
  ]);

  async function pickProduct(slug: string | number) {
    filing.productSlug = String(slug);
    draft.component = "";
    await filing.productChanged();
  }

  async function pickCustomer(slug: string | number) {
    draft.customerSlug = String(slug);
    draft.unit = "";
    filing.customerSlug = draft.customerSlug;
    await filing.customerChanged();
  }
</script>

{#snippet text(label: string)}
  <span class="value mono" class:none={!label || label === NONE.label}
    >{label || NONE.label}</span
  >
{/snippet}

{#snippet componentText()}
  {@render text(draft.component)}
{/snippet}

{#snippet quality(label: string)}
  {@const meter = qualityMeter(label)}
  {#if meter}
    <Meter value={meter.fraction} width={8} tone={meter.tone} {label} />
  {:else}
    <span class="value none">{NONE.label}</span>
  {/if}
{/snippet}

<dl class="props">
  {#if creating}
    <div class="row">
      <dt>{t("product")}</dt>
      <dd class="wide">
        <Select
          face={text}
          value={filing.productSlug}
          options={productOptions}
          aria-label={t("product")}
          onchange={pickProduct}
        />
      </dd>
    </div>
  {/if}

  {#if canEdit}
    <div class="row" class:unsaved={unsaved.has("component")}>
      <dt>component</dt>
      <dd class="wide">
        <Select
          face={componentText}
          value={draft.component}
          options={[NONE, ...filing.componentChoices]}
          disabled={!filing.productSlug}
          aria-label="component"
          onchange={(slug) => (draft.component = String(slug))}
        />
      </dd>
    </div>
  {/if}

  {#if showCustomer() && (canEdit || draft.customerSlug)}
    <div class="row" class:unsaved={unsaved.has("customerSlug")}>
      <dt>{t("customer")}</dt>
      <dd class="wide">
        {#if canEdit}
          <Select
            face={text}
            value={draft.customerSlug}
            options={customerOptions}
            searchable
            aria-label={t("customer")}
            onchange={pickCustomer}
          />
        {:else}
          {@render text(draft.customerSlug)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if showCustomer() && (canEdit || draft.unit)}
    <div class="row" class:unsaved={unsaved.has("unit")}>
      <dt>unit</dt>
      <dd class="wide">
        {#if canEdit}
          <Select
            face={text}
            value={draft.unit}
            options={unitOptions}
            disabled={!draft.customerSlug}
            aria-label="unit"
            onchange={(slug) => (draft.unit = String(slug))}
          />
        {:else}
          {@render text(draft.unit)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.cloud}
    <div class="row" class:unsaved={unsaved.has("cloud")}>
      <dt>{t("cloud")}</dt>
      <dd class="wide">
        {#if canEdit}
          <Select
            face={text}
            value={draft.cloud}
            options={environments.map((environment) => environment.cloud)}
            creatable
            aria-label={t("cloud")}
            onchange={(cloud) => (draft.cloud = String(cloud))}
          />
          {#if problems.cloud}<p class="problem">{problems.cloud}</p>{/if}
        {:else}
          {@render text(draft.cloud)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.resolutionPattern}
    <div class="row" class:unsaved={unsaved.has("resolutionPattern")}>
      <dt>pattern</dt>
      <dd class="wide">
        {#if canEdit}
          <Select
            face={text}
            value={draft.resolutionPattern}
            options={[NONE, ...patterns.map((p) => p.slug as string)]}
            aria-label="resolution pattern"
            onchange={(slug) => (draft.resolutionPattern = String(slug))}
          />
        {:else}
          {@render text(draft.resolutionPattern)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.hiddenFix}
    <div class="row" class:unsaved={unsaved.has("hiddenFix")}>
      <dt>hidden fix</dt>
      <dd class="wide">
        {#if canEdit}
          <Select
            face={text}
            value={draft.hiddenFix ? "yes" : "no"}
            options={YES_NO}
            aria-label="hidden fix"
            onchange={(answer) => (draft.hiddenFix = answer === "yes")}
          />
        {:else}
          {@render text("yes")}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.confidence}
    <div class="row" class:unsaved={unsaved.has("confidence")}>
      <dt>confidence</dt>
      <dd>
        {#if canEdit}
          <Select
            face={quality}
            value={draft.confidence}
            options={[NONE, ...CONFIDENCES]}
            aria-label="confidence"
            onchange={(level) => (draft.confidence = String(level))}
          />
        {:else}
          {@render quality(draft.confidence)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.resolutionClarity}
    <div class="row" class:unsaved={unsaved.has("resolutionClarity")}>
      <dt>clarity</dt>
      <dd>
        {#if canEdit}
          <Select
            face={quality}
            value={draft.resolutionClarity}
            options={[NONE, ...RESOLUTION_CLARITIES]}
            aria-label="clarity"
            onchange={(level) => (draft.resolutionClarity = String(level))}
          />
        {:else}
          {@render quality(draft.resolutionClarity)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.affectedVersion}
    <div class="row" class:unsaved={unsaved.has("affectedVersion")}>
      <dt>affected</dt>
      <dd class="affected">
        {#if canEdit}
          <input
            class="inline"
            aria-label="affected version"
            placeholder={NONE.label}
            bind:value={draft.affectedVersion}
          />
        {:else}
          {@render text(draft.affectedVersion)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if canEdit || draft.fixedVersion}
    <div class="row" class:unsaved={unsaved.has("fixedVersion")}>
      <dt>fixed</dt>
      <dd class="fixed">
        {#if canEdit}
          <input
            class="inline"
            aria-label="fixed version"
            placeholder={NONE.label}
            bind:value={draft.fixedVersion}
          />
        {:else}
          {@render text(draft.fixedVersion)}
        {/if}
      </dd>
    </div>
  {/if}

  {#if entry?.work_item_external_id}
    <div class="row">
      <dt>source</dt>
      <dd class="wide mono">
        {#if entry.work_item_url}
          <a
            href={entry.work_item_url}
            target="_blank"
            rel="noopener noreferrer">#{entry.work_item_external_id}</a
          >
        {:else}
          #{entry.work_item_external_id}
        {/if}
      </dd>
    </div>
  {/if}
</dl>

<style>
  /* Four tracks: a fact alone spans the last three, and confidence and
     affected each share their row with the fact that pairs with them. */
  .props {
    display: grid;
    grid-template-columns:
      max-content minmax(0, 1fr)
      max-content minmax(0, 1fr);
    align-items: baseline;
    gap: var(--pad-2) var(--pad-3);
    margin: 0;
    font-size: var(--fs-sm);
  }
  .row {
    display: contents;
  }
  dt {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  /* The right padding parts a value from the label beside it in a shared row. */
  dd {
    min-width: 0;
    margin: 0;
    padding-right: var(--pad-3);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .wide {
    grid-column: 2 / -1;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .none {
    color: var(--muted);
  }
  .affected {
    color: var(--warn);
  }
  .fixed {
    color: var(--ok);
  }
  .row.unsaved dt,
  .row.unsaved dd {
    color: var(--accent);
  }
  /* As tall as the text beside it, so the rows keep one rhythm. */
  .inline {
    box-sizing: border-box;
    width: 100%;
    height: 1.6em;
    min-height: 0;
    padding: 0;
    font: inherit;
    font-family: var(--font-mono);
    line-height: inherit;
    color: inherit;
    background: none;
    border: none;
    border-bottom: 1px dotted transparent;
    border-radius: 0;
  }
  .inline:hover,
  .inline:focus {
    outline: none;
    border-bottom-color: currentColor;
  }
  .inline::placeholder {
    color: var(--muted);
  }
  a {
    color: var(--accent);
  }
  .problem {
    margin: var(--pad-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
  /* Folded above the summary the column is wide: two facts a line. */
  @media (max-width: 72rem) {
    .wide {
      grid-column: auto;
    }
  }
  @media (max-width: 40rem) {
    .props {
      grid-template-columns: max-content minmax(0, 1fr);
    }
  }
</style>
