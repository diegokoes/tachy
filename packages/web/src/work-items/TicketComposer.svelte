<script lang="ts">
  import type {
    ComposerProject,
    WorkItemTypeOption,
    CreatedTicket,
    FieldSpec,
    ReviewFinding,
  } from "@tachy/contract";
  import { pushScope } from "../keys/keys.svelte";
  import {
    Badge,
    BarField,
    Button,
    Chevron,
    Icon,
    InfoMark,
    Note,
    Select,
    tip,
  } from "../tui";
  import { typeColor, typeIcon } from "./ado-icons";
  import {
    az,
    ensureProjects,
    ensureTypes,
    retryTypes,
    typesFailed,
    typesNote,
    typesOf,
  } from "./az.svelte";
  import {
    applyTemplate,
    askReview,
    closeComposer,
    composer,
    create,
    discardAndLeave,
    saveDraft,
    setProject,
    setType,
    setValue,
    validate,
  } from "./composer.svelte";
  import FieldInput from "./FieldInput.svelte";
  import {
    arrange,
    fieldForName,
    helpOf,
    isBody,
    labelOf,
    missingRequired,
    TITLE,
  } from "./layout";
  import MarkdownField from "./MarkdownField.svelte";
  import ReviewRail from "./ReviewRail.svelte";
  import SourceTray from "./SourceTray.svelte";

  let {
    oncreated,
  }: {
    oncreated: (
      ticket: CreatedTicket,
      type: WorkItemTypeOption,
      project: ComposerProject,
    ) => void;
  } = $props();

  /** The template last applied, while the form still offers it. */
  let appliedTemplate = $state("");

  $effect(() => {
    ensureProjects();
  });
  $effect(() => {
    if (composer.project) ensureTypes(composer.project.id);
  });
  $effect(() => {
    void [
      composer.project,
      composer.type,
      composer.title,
      composer.values,
      composer.context,
    ];
    saveDraft();
  });

  $effect(() => pushScope([{ key: "esc", run: closeComposer }]));

  const types = $derived(composer.project ? typesOf(composer.project.id) : []);
  const form = $derived(composer.form);
  const arranged = $derived(form ? arrange(form) : null);
  const specs = $derived(
    new Map((form?.fields ?? []).map((f) => [f.reference_name, f])),
  );

  const missing = $derived(
    form ? missingRequired(form.fields, composer.title, composer.values) : [],
  );
  const rejected = $derived(
    new Set(
      (composer.validation?.fields ?? [])
        .map((n) => (form ? fieldForName(form.fields, n) : null))
        .filter((r): r is string => !!r),
    ),
  );

  const findingsFor = $derived.by(() => {
    const by = new Map<string, number>();
    for (const finding of composer.review?.findings ?? [])
      if (!composer.dismissed.includes(finding.id))
        by.set(finding.field, (by.get(finding.field) ?? 0) + 1);
    return by;
  });
  const openFindings = $derived(
    [...findingsFor.values()].reduce((a, b) => a + b, 0),
  );

  function fieldName(ref: string) {
    if (ref === TITLE) return "title";
    if (ref === "general") return "overall";
    return form?.labels[ref] ?? specs.get(ref)?.name ?? ref;
  }

  const ORIGIN: Record<string, string> = {
    process: "process default",
    team: "sprint/area default",
    config: "tachy default",
    admin: "team default",
    template: "from template",
  };

  // The right column holds the fields; a review takes it over only once asked
  // for, and the tabs let the person go back to the fields it points at.
  let side = $state<"fields" | "review">("fields");
  let showHidden = $state(false);
  let showContext = $state(false);
  let root = $state<HTMLElement>();

  async function review() {
    side = "review";
    await askReview();
  }

  function focusField(ref: string) {
    const onRight = !!arranged?.groups.some((g) =>
      g.fields.some((f) => f.reference_name === ref),
    );
    const hidden = !!arranged?.hidden.some((f) => f.reference_name === ref);
    if (onRight || hidden) side = "fields";
    if (hidden) showHidden = true;
    requestAnimationFrame(() => {
      const el = root?.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(ref)}"]`,
      );
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.querySelector<HTMLElement>("input, textarea, button")?.focus({
        preventScroll: true,
      });
    });
  }

  function addImage(file: File): string {
    const key = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    composer.images.push({
      key,
      name: file.name,
      file,
      url: URL.createObjectURL(file),
    });
    return key;
  }

  function removeImage(key: string) {
    const at = composer.images.findIndex((i) => i.key === key);
    if (at < 0) return;
    URL.revokeObjectURL(composer.images[at].url);
    composer.images.splice(at, 1);
  }

  /** One suggestion into one field: appended to prose, replacing a title. */
  function apply(finding: ReviewFinding) {
    if (!finding.suggestion) return;
    if (finding.field === TITLE) composer.title = finding.suggestion;
    else {
      const spec = specs.get(finding.field);
      const now = String(composer.values[finding.field] ?? "").trimEnd();
      setValue(
        finding.field,
        spec && isBody(spec) && now
          ? `${now}\n\n${finding.suggestion}`
          : finding.suggestion,
      );
    }
    composer.dismissed = [...composer.dismissed, finding.id];
    focusField(finding.field);
  }

  async function submit() {
    const { type, project } = composer;
    if (!form || !type || !project || missing.length || composer.creating)
      return;
    const made = await create();
    if (made) oncreated(made, type, project);
  }

  /** How long the discard button waits for its second click. */
  const DISCARD_ARMED_MS = 4000;
  let discardArmed = $state(false);
  let disarm: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(disarm));

  function discard() {
    clearTimeout(disarm);
    if (!discardArmed) {
      discardArmed = true;
      disarm = setTimeout(() => (discardArmed = false), DISCARD_ARMED_MS);
      return;
    }
    discardArmed = false;
    discardAndLeave();
  }
</script>

{#snippet label(field: FieldSpec)}
  {@const origin = composer.origins[field.reference_name]}
  {@const flagged = findingsFor.get(field.reference_name)}
  {@const help = helpOf(field)}
  <span class="label">
    <label for={`f-${field.reference_name}`}>{labelOf(form, field)}</label>
    {#if field.required}<span class="req" aria-label="required">*</span>{/if}
    {#if origin}<Badge tone="muted">{ORIGIN[origin]}</Badge>{/if}
    {#if flagged}
      <button class="flag" onclick={() => (side = "review")}>
        <Icon name="review" size="0.9em" />{flagged}
      </button>
    {/if}
    {#if help}<span class="help" use:tip={help}
        ><Icon name="info" size="0.9em" /></span
      >{/if}
  </span>
{/snippet}

{#snippet row(field: FieldSpec)}
  <div
    class="row"
    class:missing={missing.includes(field.reference_name)}
    class:flagged={findingsFor.has(field.reference_name)}
    data-field={field.reference_name}
  >
    {@render label(field)}
    <FieldInput
      id={`f-${field.reference_name}`}
      spec={field}
      label={labelOf(form, field)}
      value={composer.values[field.reference_name]}
      form={form!}
      invalid={rejected.has(field.reference_name)}
      onchange={(v) => setValue(field.reference_name, v)}
    />
  </div>
{/snippet}

<section class="view" aria-label="new Azure DevOps work item" bind:this={root}>
  <header class="bar">
    <div class="where">
      <BarField label="project">
        <Select
          value={composer.project?.id ?? ""}
          placeholder="none"
          searchable
          options={(az.projects ?? []).map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          aria-label="project"
          onchange={(v) => {
            const picked = az.projects?.find((x) => x.id === v);
            if (picked && picked.id !== composer.project?.id)
              setProject(picked);
          }}
        />
      </BarField>
      {#if composer.project}
        <BarField label="type">
          <span class="typed">
            {#if composer.type}
              <span
                class="glyph"
                style:color={typeColor(composer.type.color) ?? undefined}
              >
                <Icon name={typeIcon(composer.type.icon)} size="1.05em" />
              </span>
            {/if}
            <Select
              value={composer.type?.name ?? ""}
              placeholder="none"
              options={types.map((t) => ({ value: t.name, label: t.name }))}
              aria-label="work item type"
              onchange={(v) => {
                const t = types.find((x) => x.name === v);
                if (t && t.name !== composer.type?.name) setType(t);
              }}
            />
          </span>
        </BarField>
      {/if}
      {#if form?.templates.length}
        <BarField label="template">
          <Select
            value={appliedTemplate}
            placeholder="none"
            options={form.templates.map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            aria-label="apply a team template"
            onchange={(v) => {
              if (!v) return;
              appliedTemplate = String(v);
              void applyTemplate(appliedTemplate);
            }}
          />
        </BarField>
      {/if}
    </div>

    <div class="acts">
      <Button
        variant="ghost"
        icon="attach"
        aria-pressed={showContext}
        onclick={() => (showContext = !showContext)}
        >context{composer.context.length
          ? ` · ${composer.context.length}`
          : ""}</Button
      >
      <Button
        variant="ghost"
        icon="test"
        busy={composer.checking}
        disabled={!form}
        onclick={validate}>check</Button
      >
      <Button
        icon="review"
        busy={composer.reviewing}
        disabled={!form || !composer.title.trim()}
        onclick={review}>ask tachy</Button
      >
      <Button
        variant="primary"
        icon="create"
        busy={composer.creating}
        disabled={!form || missing.length > 0}
        onclick={submit}>create</Button
      >
      <span class="rule" aria-hidden="true"></span>
      <Button
        variant={discardArmed ? "danger" : "ghost"}
        icon={discardArmed ? "confirm" : "delete"}
        morph
        aria-label="discard the draft"
        title={discardArmed ? "click again to discard" : "discard the draft"}
        onclick={discard}
      />
      <Button
        variant="ghost"
        icon="close"
        aria-label="close (the draft is kept)"
        title="close · the draft is kept"
        onclick={closeComposer}
      />
    </div>
  </header>

  {#if showContext}
    <div class="context">
      <SourceTray
        items={composer.context}
        onadd={(item) => composer.context.push(item)}
        onremove={(i) => composer.context.splice(i, 1)}
      />
    </div>
  {/if}

  {#if composer.error || composer.validation || (form && missing.length)}
    <div class="status" role="status">
      {#if composer.error}
        <span class="bad">{composer.error}</span>
      {:else if composer.validation?.ok}
        <span class="good"
          ><Icon name="success" size="1em" /> Azure DevOps accepts it as it is</span
        >
      {:else if composer.validation}
        <span class="bad">{composer.validation.message}</span>
      {/if}
    </div>
  {/if}

  <div class="body">
    {#if az.projectsError}
      <Note tone="danger">{az.projectsError}</Note>
    {:else if !composer.project}
      {#if az.projects && !az.projects.length}
        <Note tone="warn">
          none of your teams has an Azure DevOps project registered. a team
          admin registers one under console › integrations › projects
        </Note>
      {:else}
        <div class="pick">
          <p class="dim">pick the project this goes into</p>
          <div class="cards">
            {#each az.projects ?? [] as project (project.id)}
              <button class="card" onclick={() => setProject(project)}>
                <span class="name">{project.name}</span>
                <span class="dim"
                  >{project.product_slug ?? project.team_slug}</span
                >
              </button>
            {/each}
          </div>
        </div>
      {/if}
    {:else if !composer.type}
      {@const projectId = composer.project.id}
      <div class="pick">
        <p class="dim">what are you raising?</p>
        {#if typesFailed(projectId)}
          <Note tone="danger">
            {typesNote(projectId)}
            {#snippet action()}
              <Button
                size="sm"
                variant="ghost"
                icon="refresh"
                onclick={() => retryTypes(projectId)}>retry</Button
              >
            {/snippet}
          </Note>
        {/if}
        <div class="cards">
          {#each types as type (type.name)}
            <button class="card type" onclick={() => setType(type)}>
              <span
                class="glyph"
                style:color={typeColor(type.color) ?? undefined}
              >
                <Icon name={typeIcon(type.icon)} size="1.4em" />
              </span>
              <span class="name">{type.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="write">
        <div
          class="row title"
          class:missing={missing.includes(TITLE)}
          class:flagged={findingsFor.has(TITLE)}
          data-field={TITLE}
        >
          <span class="label">
            <label for="f-title">{composer.type.name} title</label>
            <span class="req" aria-label="required">*</span>
            <InfoMark label="about the title"
              >one line a developer understands at a glance</InfoMark
            >
            {#if findingsFor.get(TITLE)}
              <button class="flag" onclick={() => (side = "review")}
                ><Icon name="review" size="0.9em" />{findingsFor.get(
                  TITLE,
                )}</button
              >
            {/if}
          </span>
          <input
            id="f-title"
            class:invalid={rejected.has(TITLE)}
            bind:value={composer.title}
          />
        </div>
        {#if composer.loading && !form}
          <p class="dim">
            reading {composer.project.name}'s {composer.type.name} form…
          </p>
        {/if}
        {#each arranged?.body ?? [] as field (field.reference_name)}
          <div
            class="row"
            class:missing={missing.includes(field.reference_name)}
            class:flagged={findingsFor.has(field.reference_name)}
            data-field={field.reference_name}
          >
            {@render label(field)}
            <MarkdownField
              id={`f-${field.reference_name}`}
              label={labelOf(form, field)}
              value={String(composer.values[field.reference_name] ?? "")}
              images={composer.images}
              invalid={rejected.has(field.reference_name)}
              onchange={(v) => setValue(field.reference_name, v)}
              onimage={addImage}
              onremoveimage={removeImage}
            />
          </div>
        {/each}
      </div>

      <aside class="side">
        {#if composer.review || composer.reviewing}
          <div class="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={side === "fields"}
              class:active={side === "fields"}
              onclick={() => (side = "fields")}>fields</button
            >
            <button
              role="tab"
              aria-selected={side === "review"}
              class:active={side === "review"}
              onclick={() => (side = "review")}
              ><Icon name="review" size="0.95em" /> review{openFindings
                ? ` · ${openFindings}`
                : ""}</button
            >
          </div>
        {/if}

        {#if side === "review" && (composer.review || composer.reviewing)}
          <ReviewRail
            review={composer.review}
            previous={composer.previous}
            dismissed={composer.dismissed}
            reviewing={composer.reviewing}
            {fieldName}
            onapply={apply}
            ondismiss={(id) =>
              (composer.dismissed = [...composer.dismissed, id])}
            onfocus={focusField}
          />
        {:else if form && arranged}
          {#each arranged.groups as group, i (group.label ?? `header-${i}`)}
            <fieldset class="group">
              {#if group.label}<legend>{group.label}</legend>{/if}
              {#each group.fields as field (field.reference_name)}
                {@render row(field)}
              {/each}
            </fieldset>
          {/each}
          {#if arranged.hidden.length}
            <button
              class="more"
              aria-expanded={showHidden}
              onclick={() => (showHidden = !showHidden)}
            >
              <Chevron open={showHidden} />
              {arranged.hidden.length} more fields
            </button>
            {#if showHidden}
              <fieldset class="group">
                {#each arranged.hidden as field (field.reference_name)}
                  {@render row(field)}
                {/each}
              </fieldset>
            {/if}
          {/if}
        {/if}
      </aside>
    {/if}
  </div>
</section>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--pad-2) var(--pad-4);
    padding-bottom: var(--pad-2);
    border-bottom: 1px dashed var(--border);
  }
  .where,
  .acts {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-width: 0;
  }
  /* On the controls' line, under their caps. */
  .where {
    align-items: end;
  }
  .typed {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .rule {
    width: 1px;
    align-self: stretch;
    margin: 0 var(--pad-1);
    background: var(--border);
  }
  .context,
  .status {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1) var(--pad-3);
    padding: var(--pad-2) 0;
    border-bottom: 1px dashed var(--border);
    font-size: var(--fs-sm);
  }
  .good {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    color: var(--ok);
  }
  .bad {
    color: var(--danger);
  }
  .dim {
    color: var(--muted);
    font-size: var(--fs-sm);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(16rem, 1fr);
    align-items: start;
    gap: var(--pad-4);
    padding-top: var(--pad-3);
  }
  .pick {
    grid-column: 1 / -1;
  }
  .write {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
  }
  .side {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    min-width: 0;
    padding-left: var(--pad-3);
    border-left: 1px dashed var(--border);
  }
  .tabs {
    display: flex;
    gap: var(--pad-3);
    border-bottom: 1px dashed var(--border);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    padding: 0 0 var(--pad-1);
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    margin: 0;
    padding: 0;
    border: none;
  }
  legend {
    padding: 0 0 var(--pad-1);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--pad-2);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding: var(--pad-3);
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .card:hover,
  .card:focus-visible {
    border-color: var(--accent);
  }
  .glyph {
    display: inline-flex;
    color: var(--muted);
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding-left: var(--pad-2);
    border-left: 2px solid transparent;
  }
  .row.flagged {
    border-left-color: var(--accent);
  }
  .row.missing {
    border-left-color: var(--warn);
  }
  .row.title input {
    font-size: var(--fs-lg);
  }
  .label {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .req {
    color: var(--warn);
  }
  .help {
    display: inline-flex;
  }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0 0.3rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-chip);
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .more {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .invalid {
    border-color: var(--danger);
  }

  @media (max-width: 56rem) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      position: static;
      padding-left: 0;
      border-left: none;
    }
  }
</style>
