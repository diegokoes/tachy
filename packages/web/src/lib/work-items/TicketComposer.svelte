<script lang="ts">
  import type { AdoTypeOption, CreatedTicket, FieldSpec, ReviewFinding } from "@tachy/contract";
  import { pushScope } from "../keys.svelte";
  import { Badge, Button, Chevron, Icon, Note, Select, tip } from "../tui";
  import { typeColor, typeIcon } from "./ado-icons";
  import { az, ensureProjects, ensureTypes, typesOf } from "./az.svelte";
  import {
    applyTemplate,
    askReview,
    closeComposer,
    composer,
    create,
    discardDraft,
    saveDraft,
    setProject,
    setType,
    setValue,
    validate,
  } from "./composer.svelte";
  import FieldInput from "./FieldInput.svelte";
  import { fieldForName, isBody, layoutFields, missingRequired, TITLE } from "./layout";
  import MarkdownField from "./MarkdownField.svelte";
  import ReviewRail from "./ReviewRail.svelte";
  import SourceTray from "./SourceTray.svelte";

  let {
    oncreated,
  }: { oncreated: (t: CreatedTicket, type: AdoTypeOption) => void } = $props();

  $effect(() => {
    ensureProjects();
  });
  $effect(() => {
    if (composer.project) ensureTypes(composer.project.id);
  });
  $effect(() => {
    void [composer.project, composer.type, composer.title, composer.values, composer.context];
    saveDraft();
  });

  $effect(() =>
    pushScope([
      { key: "esc", label: "close", run: closeComposer },
      { key: "ctrl+⏎", label: "create", inFields: true, run: () => void submit() },
    ]),
  );

  const types = $derived(composer.project ? typesOf(composer.project.id) : []);
  const form = $derived(composer.form);
  const layout = $derived(form ? layoutFields(form.fields) : null);
  const specs = $derived(new Map((form?.fields ?? []).map((f) => [f.reference_name, f])));

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
  const invalid = (ref: string) => rejected.has(ref);

  const findingsFor = $derived.by(() => {
    const by = new Map<string, number>();
    for (const f of composer.review?.findings ?? [])
      if (!composer.dismissed.includes(f.id)) by.set(f.field, (by.get(f.field) ?? 0) + 1);
    return by;
  });

  const fieldName = (ref: string) =>
    ref === TITLE ? "Title" : ref === "general" ? "Overall" : (specs.get(ref)?.name ?? ref);

  const ORIGIN: Record<string, string> = {
    process: "process default",
    team: "team default",
    config: "tachy default",
    template: "from template",
  };

  let showMore = $state(false);
  let root = $state<HTMLElement>();

  function focusField(ref: string) {
    const el = root?.querySelector<HTMLElement>(`[data-field="${CSS.escape(ref)}"]`);
    if (!el) return;
    if (layout?.more.some((f) => f.reference_name === ref)) showMore = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
  }

  function addImage(file: File): string {
    const key = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    composer.images.push({ key, name: file.name, file, url: URL.createObjectURL(file) });
    return key;
  }

  function removeImage(key: string) {
    const at = composer.images.findIndex((i) => i.key === key);
    if (at < 0) return;
    URL.revokeObjectURL(composer.images[at].url);
    composer.images.splice(at, 1);
  }

  /** One suggestion into one field: appended to prose, replacing a title. */
  function apply(f: ReviewFinding) {
    if (!f.suggestion) return;
    if (f.field === TITLE) composer.title = f.suggestion;
    else {
      const spec = specs.get(f.field);
      const now = String(composer.values[f.field] ?? "").trimEnd();
      setValue(
        f.field,
        spec && isBody(spec) && now ? `${now}\n\n${f.suggestion}` : f.suggestion,
      );
    }
    composer.dismissed = [...composer.dismissed, f.id];
    focusField(f.field);
  }

  async function submit() {
    const type = composer.type;
    if (!form || !type || missing.length || composer.creating) return;
    const made = await create();
    if (made) oncreated(made, type);
  }

  let discardArmed = $state(false);
  function discard() {
    if (!discardArmed) {
      discardArmed = true;
      setTimeout(() => (discardArmed = false), 4000);
      return;
    }
    discardArmed = false;
    discardDraft();
  }
</script>

{#snippet label(f: FieldSpec)}
  {@const origin = composer.origins[f.reference_name]}
  {@const flagged = findingsFor.get(f.reference_name)}
  <span class="label">
    <label for={`f-${f.reference_name}`}>{f.name}</label>
    {#if f.required}<span class="req" aria-label="required">*</span>{/if}
    {#if origin}<Badge tone="muted">{ORIGIN[origin]}</Badge>{/if}
    {#if flagged}
      <button class="flag" use:tip={"tachy flagged this"} onclick={() => focusField(f.reference_name)}>
        <Icon name="review" size="0.9em" />{flagged}
      </button>
    {/if}
    {#if f.help_text}<span class="help" use:tip={f.help_text}><Icon name="info" size="0.9em" /></span>{/if}
  </span>
{/snippet}

{#snippet row(f: FieldSpec)}
  <div
    class="row"
    class:missing={missing.includes(f.reference_name)}
    class:flagged={findingsFor.has(f.reference_name)}
    data-field={f.reference_name}
  >
    {@render label(f)}
    <FieldInput
      id={`f-${f.reference_name}`}
      spec={f}
      value={composer.values[f.reference_name]}
      form={form!}
      invalid={invalid(f.reference_name)}
      onchange={(v) => setValue(f.reference_name, v)}
    />
  </div>
{/snippet}

<section class="view" aria-label="New Azure DevOps work item" bind:this={root}>
  <header class="head">
    <span class="crumb">/az new</span>
    <Select
      value={composer.project?.id ?? ""}
      placeholder="project"
      searchable
      options={(az.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
      aria-label="Project"
      onchange={(v) => {
        const p = az.projects?.find((x) => x.id === v);
        if (p && p.id !== composer.project?.id) setProject(p);
      }}
    />
    {#if composer.project}
      <Select
        value={composer.type?.name ?? ""}
        placeholder="type"
        options={types.map((t) => ({ value: t.name, label: t.name }))}
        aria-label="Work item type"
        onchange={(v) => {
          const t = types.find((x) => x.name === v);
          if (t && t.name !== composer.type?.name) setType(t);
        }}
      />
    {/if}
    {#if form?.templates.length}
      <Select
        value=""
        placeholder="template"
        options={form.templates.map((t) => ({ value: t.id, label: t.name }))}
        aria-label="Apply a team template"
        onchange={(v) => v && applyTemplate(String(v))}
      />
    {/if}
    <span class="spacer"></span>
    <Button variant="ghost" icon="close" aria-label="Close (the draft is kept)" title="close · the draft is kept" onclick={closeComposer} />
  </header>

  <div class="body">
    <div class="form">
      {#if az.projectsError}
        <Note tone="danger">{az.projectsError}</Note>
      {:else if !composer.project}
        {#if az.projects && !az.projects.length}
          <Note tone="warn">
            None of your teams has an Azure DevOps project registered. A team admin registers one under Admin › integrations › projects.
          </Note>
        {:else}
          <p class="dim">Pick the project this goes into.</p>
          <div class="cards">
            {#each az.projects ?? [] as p (p.id)}
              <button class="card" onclick={() => setProject(p)}>
                <span class="name">{p.name}</span>
                <span class="dim">{p.product_slug ?? p.team_slug}</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else if !composer.type}
        <p class="dim">What are you raising?</p>
        <div class="cards">
          {#each types as t (t.name)}
            <button class="card type" onclick={() => setType(t)}>
              <span class="glyph" style:color={typeColor(t.color) ?? undefined}>
                <Icon name={typeIcon(t.icon)} size="1.4em" />
              </span>
              <span class="name">{t.name}</span>
              {#if t.description}<span class="dim desc">{t.description}</span>{/if}
            </button>
          {/each}
        </div>
      {:else}
        {#if composer.error}<Note tone="danger">{composer.error}</Note>{/if}
        {#if composer.loading && !form}
          <p class="dim">reading {composer.project.name}'s {composer.type.name} form…</p>
        {/if}
        <div
          class="row title"
          class:missing={missing.includes(TITLE)}
          class:flagged={findingsFor.has(TITLE)}
          data-field={TITLE}
        >
          <span class="label">
            <span class="glyph" style:color={typeColor(composer.type.color) ?? undefined}>
              <Icon name={typeIcon(composer.type.icon)} size="1em" />
            </span>
            <label for="f-title">{composer.type.name} title</label>
            <span class="req" aria-label="required">*</span>
            {#if findingsFor.get(TITLE)}
              <button class="flag" onclick={() => focusField(TITLE)}><Icon name="review" size="0.9em" />{findingsFor.get(TITLE)}</button>
            {/if}
          </span>
          <input id="f-title" class:invalid={invalid(TITLE)} bind:value={composer.title} placeholder="one line a developer understands at a glance" />
        </div>

        {#if form && layout}
          {#each layout.body as f (f.reference_name)}
            <div
              class="row"
              class:missing={missing.includes(f.reference_name)}
              class:flagged={findingsFor.has(f.reference_name)}
              data-field={f.reference_name}
            >
              {@render label(f)}
              <MarkdownField
                id={`f-${f.reference_name}`}
                label={f.name}
                value={String(composer.values[f.reference_name] ?? "")}
                images={composer.images}
                invalid={invalid(f.reference_name)}
                onchange={(v) => setValue(f.reference_name, v)}
                onimage={addImage}
                onremoveimage={removeImage}
              />
            </div>
          {/each}

          <div class="grid">
            {#each [...layout.core, ...layout.required] as f (f.reference_name)}
              {@render row(f)}
            {/each}
          </div>

          {#if layout.more.length}
            <button class="more" aria-expanded={showMore} onclick={() => (showMore = !showMore)}>
              <Chevron open={showMore} /> {layout.more.length} more fields
            </button>
            {#if showMore}
              <div class="grid">
                {#each layout.more as f (f.reference_name)}
                  {@render row(f)}
                {/each}
              </div>
            {/if}
          {/if}
        {/if}
      {/if}
    </div>

    {#if composer.type}
      <ReviewRail
        review={composer.review}
        previous={composer.previous}
        dismissed={composer.dismissed}
        reviewing={composer.reviewing}
        {fieldName}
        onapply={apply}
        ondismiss={(id) => (composer.dismissed = [...composer.dismissed, id])}
        onfocus={focusField}
      />
    {/if}
  </div>

  <footer class="foot">
    <SourceTray
      items={composer.context}
      onadd={(item) => composer.context.push(item)}
      onremove={(i) => composer.context.splice(i, 1)}
    />
    {#if composer.validation}
      {#if composer.validation.ok}
        <Note tone="ok">Azure DevOps accepts it as it is.</Note>
      {:else}
        <Note tone="danger">{composer.validation.message}</Note>
      {/if}
    {/if}
    <div class="acts">
      <Button
        variant={discardArmed ? "danger" : "ghost"}
        icon={discardArmed ? "confirm" : "delete"}
        morph
        aria-label="Discard the draft"
        title={discardArmed ? "click again to discard" : "discard the draft"}
        onclick={discard}
      />
      <span class="spacer"></span>
      {#if missing.length}
        <span class="dim">still needed: {missing.map(fieldName).join(", ")}</span>
      {/if}
      <Button
        variant="ghost"
        icon="test"
        busy={composer.checking}
        disabled={!form}
        title="ask Azure DevOps whether it would accept this, without creating it"
        onclick={validate}>check</Button
      >
      <Button
        icon="review"
        busy={composer.reviewing}
        disabled={!form || !composer.title.trim()}
        title="tachy reviews your ticket as the developer picking it up"
        onclick={askReview}>ask tachy</Button
      >
      <Button
        variant="primary"
        icon="create"
        busy={composer.creating}
        disabled={!form || missing.length > 0}
        title="create it in Azure DevOps (ctrl+enter)"
        onclick={submit}>create</Button
      >
    </div>
  </footer>
</section>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding-bottom: var(--pad-2);
    border-bottom: 1px dashed var(--border);
  }
  .crumb {
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    padding: var(--pad-3) var(--pad-3) var(--pad-3) 0;
    overflow-y: auto;
    min-width: 0;
  }
  .dim {
    color: var(--muted);
    font-size: var(--fs-sm);
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
  .card .desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--pad-3);
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
    cursor: pointer;
  }
  .invalid {
    border-color: var(--danger);
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    padding-top: var(--pad-2);
    border-top: 1px dashed var(--border);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  @media (max-width: 52rem) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      overflow-y: auto;
    }
    .form {
      overflow: visible;
      padding-right: 0;
    }
  }
</style>
