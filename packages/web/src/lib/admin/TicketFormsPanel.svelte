<script lang="ts">
  import type {
    ComposeConfig,
    ComposerForm,
    ComposerProject,
    FieldFormConfig,
    FieldSpec,
    TypeFormConfig,
    WorkItemTypeOption,
  } from "@tachy/contract";
  import { api } from "../api";
  import { keep, recall } from "../kept";
  import { navigate } from "../router.svelte";
  import { Badge, Button, Icon, Note, Select, tip } from "../tui";
  import { typeColor, typeIcon } from "../work-items/ado-icons";
  import { openComposer } from "../work-items/composer.svelte";
  import FieldInput from "../work-items/FieldInput.svelte";
  import { arrange, editable, labelOf, TITLE } from "../work-items/layout";

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let projects = $state<ComposerProject[]>([]);
  let projectsError = $state<string | null>(null);
  $effect(() => {
    api
      .get<ComposerProject[]>("/compose/projects")
      .then((p) => {
        projects = p;
        if (!p.some((x) => x.id === projectId)) projectId = p[0]?.id ?? "";
      })
      .catch((e) => (projectsError = errText(e)));
  });

  let projectId = $state(recall("admin.flows.project", ""));
  $effect(() => keep("admin.flows.project", projectId));
  const project = $derived(projects.find((p) => p.id === projectId) ?? null);

  let types = $state<WorkItemTypeOption[]>([]);
  let cfg = $state<ComposeConfig>({});
  let saved = $state("{}");
  let loadError = $state<string | null>(null);
  let type = $state("");

  $effect(() => {
    const id = projectId;
    if (!id) return;
    loadError = null;
    types = [];
    Promise.all([
      api.get<WorkItemTypeOption[]>(`/compose/projects/${id}/types?all=1`),
      api.get<ComposeConfig>(`/compose/projects/${id}/config`),
    ])
      .then(([t, c]) => {
        if (id !== projectId) return;
        types = t;
        cfg = c ?? {};
        saved = JSON.stringify(cfg);
        type = offered[0] ?? t[0]?.name ?? "";
      })
      .catch((e) => (loadError = errText(e)));
  });

  let raw = $state<ComposerForm | null>(null);
  let formError = $state<string | null>(null);
  $effect(() => {
    const id = projectId;
    const ty = type;
    raw = null;
    formError = null;
    if (!id || !ty) return;
    api
      .get<ComposerForm>(
        `/compose/projects/${id}/form?type=${encodeURIComponent(ty)}&raw=1`,
      )
      .then((f) => {
        if (id === projectId && ty === type) raw = f;
      })
      .catch((e) => (formError = errText(e)));
  });

  const dirty = $derived(JSON.stringify(cfg) !== saved);

  /* ---- types offered ----------------------------------------------------- */

  /** Every type, while the team has not picked; its pick in its order after. */
  const offered = $derived(
    cfg.types?.length ? cfg.types : types.map((t) => t.name),
  );
  const typeByName = $derived(new Map(types.map((t) => [t.name, t])));
  const unoffered = $derived(types.filter((t) => !offered.includes(t.name)));

  function setTypes(next: string[]) {
    cfg = { ...cfg, types: next };
  }
  function toggleType(name: string) {
    if (offered.includes(name)) {
      if (offered.length > 1) setTypes(offered.filter((n) => n !== name));
    } else setTypes([...offered, name]);
  }
  function moveType(name: string, by: -1 | 1) {
    const list = [...offered];
    const i = list.indexOf(name);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setTypes(list);
  }

  /* ---- one type's form --------------------------------------------------- */

  const tc = $derived<TypeFormConfig>(cfg.forms?.[type] ?? {});

  function setTc(next: TypeFormConfig) {
    const forms = { ...(cfg.forms ?? {}) };
    const empty =
      !Object.keys(next.fields ?? {}).length &&
      !next.order?.length &&
      !next.guidance?.trim();
    if (empty) delete forms[type];
    else forms[type] = next;
    cfg = { ...cfg, forms };
  }

  function setField(ref: string, patch: Partial<FieldFormConfig>) {
    const fields = { ...(tc.fields ?? {}) };
    const next: FieldFormConfig = { ...(fields[ref] ?? {}), ...patch };
    if (!next.show) delete next.show;
    if (!next.default) delete next.default;
    if (Object.keys(next).length) fields[ref] = next;
    else delete fields[ref];
    setTc({ ...tc, fields });
  }

  /** The form as the composer will draw it with the config as it stands now. */
  const effective = $derived.by(() => {
    if (!raw) return null;
    const prefill = { ...raw.prefill };
    const show: Record<string, "form" | "fold" | "hidden"> = {};
    for (const [ref, fc] of Object.entries(tc.fields ?? {})) {
      if (fc.show) show[ref] = fc.show;
      if (fc.default)
        prefill[ref] = {
          value: "macro" in fc.default ? fc.default.macro : fc.default.value,
          origin: "admin",
        };
    }
    return arrange({ ...raw, prefill, display: { show, order: tc.order ?? [] } });
  });

  type Block = { key: string; title: string; hint?: string; fields: FieldSpec[] };
  const blocks = $derived.by<Block[]>(() => {
    if (!raw || !effective) return [];
    const drawn = new Set(
      [
        ...effective.body,
        ...effective.groups.flatMap((g) => g.fields),
        ...effective.hidden,
      ].map((f) => f.reference_name),
    );
    const out: Block[] = [
      { key: "body", title: "written", hint: "left column", fields: effective.body },
      ...effective.groups.map((g, i) => ({
        key: `g${i}`,
        title: g.label ?? "header",
        hint:
          i === 0 && !g.label
            ? "right column"
            : g.label === "also required"
              ? "nothing fills them, so they stay on screen whatever is set"
              : undefined,
        fields: g.fields,
      })),
      { key: "folded", title: "folded away", hint: "under “more fields”", fields: effective.hidden },
      {
        key: "out",
        title: "left out",
        hint: "never shown; a default is still sent",
        fields: raw.fields.filter(
          (f) => f.reference_name !== TITLE && editable(f) && !drawn.has(f.reference_name),
        ),
      },
    ];
    return out.filter((b) => b.fields.length);
  });

  /** Order is the drawn order, read back after a move within one block. */
  function move(block: Block, ref: string, by: -1 | 1) {
    const i = block.fields.findIndex((f) => f.reference_name === ref);
    const j = i + by;
    if (i < 0 || j < 0 || j >= block.fields.length) return;
    const order = blocks.flatMap((b) => {
      const refs = b.fields.map((f) => f.reference_name);
      if (b.key === block.key) [refs[i], refs[j]] = [refs[j], refs[i]];
      return refs;
    });
    setTc({ ...tc, order });
  }

  const SOURCE_NAMES: Record<string, string> = {
    "azure-devops": "ADO",
    github: "GitHub",
    freshdesk: "Freshdesk",
  };
  const sourceName = $derived(
    project ? (SOURCE_NAMES[project.source_type] ?? project.source_type) : "",
  );

  /** What the source's own form does with each field, before any config. */
  const sourceShows = $derived.by(() => {
    if (!raw) return new Set<string>();
    const a = arrange(raw);
    return new Set(
      [...a.body, ...a.groups.flatMap((g) => g.fields)].map((f) => f.reference_name),
    );
  });

  /* The first choice names what "no choice" means for this field, which is
     what the source does with it; the rest are the team overriding that. */
  const showOptions = (ref: string) => [
    {
      value: "",
      label: `like ${sourceName} · ${sourceShows.has(ref) ? "shown" : "hidden"}`,
    },
    { value: "form", label: "always show" },
    { value: "fold", label: "fold away", hint: "under more fields" },
    { value: "hidden", label: "leave out", hint: "default still sent" },
  ];

  const isPerson = (f: FieldSpec) => !!f.is_identity || f.type === "identity";
  const ME = "@me";
  function personOptions(current: string) {
    const people = (raw?.people ?? []).map((p) => ({
      value: p.unique_name,
      label: p.name,
      hint: p.unique_name,
    }));
    return [
      { value: "", label: "(no default)" },
      { value: ME, label: "me", hint: "whoever creates it" },
      ...(current && current !== ME && !people.some((p) => p.value === current)
        ? [{ value: current, label: current }]
        : []),
      ...people,
    ];
  }

  function defaultOf(ref: string): string {
    const d = tc.fields?.[ref]?.default;
    if (!d) return "";
    return "macro" in d ? d.macro : String(d.value ?? "");
  }
  function setDefault(ref: string, v: unknown) {
    if (v == null || v === "") setField(ref, { default: undefined });
    else if (v === ME) setField(ref, { default: { macro: "@me" } });
    else setField(ref, { default: { value: v as string | number | boolean } });
  }

  const sourceDefault = (ref: string) => {
    const p = raw?.prefill[ref];
    return p && p.origin !== "admin" ? String(p.value) : null;
  };

  /* ---- save ---------------------------------------------------------------- */

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  async function save() {
    if (!projectId) return;
    saving = true;
    saveError = null;
    try {
      cfg = await api.put<ComposeConfig>(`/compose/projects/${projectId}/config`, cfg);
      saved = JSON.stringify(cfg);
    } catch (e) {
      saveError = errText(e);
    } finally {
      saving = false;
    }
  }

  function tryIt() {
    const t = typeByName.get(type);
    if (!project || !t) return;
    navigate("/chat");
    openComposer(project, t);
  }
</script>

<div class="flows">
  <nav class="projects" aria-label="Projects">
    <span class="head">projects</span>
    {#if projectsError}<Note tone="danger">{projectsError}</Note>{/if}
    {#each projects as p (p.id)}
      <button class="proj" class:active={p.id === projectId} onclick={() => (projectId = p.id)}>
        <span>{p.name}</span>
        <span class="muted">{p.source_type} · {p.product_slug ?? p.team_slug}</span>
      </button>
    {:else}
      {#if !projectsError}<p class="muted">No registered projects your teams own.</p>{/if}
    {/each}
  </nav>

  <section class="editor" aria-label="Ticket form">
    {#if !project}
      <p class="muted">Pick a project.</p>
    {:else if loadError}
      <Note tone="danger">{loadError}</Note>
    {:else}
      <header class="bar">
        <div class="title">
          <span class="crumb">{project.name}</span>
          <span class="muted">what /{project.source_type === "azure-devops" ? "az" : project.source_type} new offers, and how its forms start</span>
        </div>
        <div class="acts">
          {#if saveError}<span class="bad">{saveError}</span>{/if}
          <Button variant="ghost" icon="run" disabled={dirty || !raw} title={dirty ? "save first" : "open this form in the composer"} onclick={tryIt}>try it</Button>
          <Button variant="primary" icon="save" busy={saving} disabled={!dirty} onclick={save}>save</Button>
        </div>
      </header>

      <div class="types">
        <span class="label">types offered</span>
        <div class="chips">
          {#each offered as name, i (name)}
            {@const t = typeByName.get(name)}
            <span class="type" class:current={name === type}>
              <button class="pick" onclick={() => (type = name)} use:tip={"edit this type's form"}>
                <span class="glyph" style:color={typeColor(t?.color) ?? undefined}>
                  <Icon name={typeIcon(t?.icon)} size="1em" />
                </span>
                {name}
              </button>
              <button class="tiny" aria-label={`Move ${name} earlier`} disabled={i === 0} onclick={() => moveType(name, -1)}><Icon name="moveUp" size="0.8em" /></button>
              <button class="tiny" aria-label={`Move ${name} later`} disabled={i === offered.length - 1} onclick={() => moveType(name, 1)}><Icon name="moveDown" size="0.8em" /></button>
              <button class="tiny" aria-label={`Stop offering ${name}`} disabled={offered.length === 1} onclick={() => toggleType(name)}><Icon name="close" size="0.8em" /></button>
            </span>
          {/each}
          {#each unoffered as t (t.name)}
            <button class="type off" onclick={() => toggleType(t.name)} use:tip={"offer it"}>
              <Icon name="plus" size="0.8em" /> {t.name}
            </button>
          {/each}
          {#if cfg.types?.length}
            <button class="link" onclick={() => (cfg = { ...cfg, types: undefined })}>offer every type</button>
          {/if}
        </div>
      </div>

      {#if formError}
        <Note tone="danger">{formError}</Note>
      {:else if !raw}
        <p class="muted">reading {project.name}'s {type} form…</p>
      {:else}
        <div class="table" role="table" aria-label={`${type} fields`}>
          <div class="row headrow" role="row">
            <span role="columnheader">field</span>
            <span role="columnheader">where it shows</span>
            <span role="columnheader">starts as</span>
            <span role="columnheader"><span class="sr">order</span></span>
          </div>
          {#each blocks as b (b.key)}
            <div class="block" role="rowgroup">
              <div class="blockhead">
                {b.title}{#if b.hint}<span class="muted"> · {b.hint}</span>{/if}
              </div>
              {#each b.fields as f, i (f.reference_name)}
                {@const fc = tc.fields?.[f.reference_name]}
                {@const src = sourceDefault(f.reference_name)}
                <div class="row" role="row">
                  <span class="field" role="cell">
                    <span>{labelOf(raw, f)}</span>
                    {#if f.required}<Badge tone="warn">required</Badge>{/if}
                    <span class="ref muted">{f.reference_name}</span>
                  </span>
                  <span role="cell">
                    <Select
                      value={fc?.show ?? ""}
                      options={showOptions(f.reference_name)}
                      aria-label={`Where ${labelOf(raw, f)} shows`}
                      onchange={(v) => setField(f.reference_name, { show: (v || undefined) as FieldFormConfig["show"] })}
                    />
                  </span>
                  <span class="def" role="cell">
                    {#if isPerson(f)}
                      {@const cur = defaultOf(f.reference_name)}
                      <span class="person">
                        <Select
                          value={cur}
                          options={personOptions(cur)}
                          searchable
                          aria-label={`Default for ${labelOf(raw, f)}`}
                          onchange={(v) => setDefault(f.reference_name, v)}
                        />
                        <button
                          class="me"
                          class:on={cur === ME}
                          aria-pressed={cur === ME}
                          title="whoever creates the ticket, each person themselves"
                          onclick={() => setDefault(f.reference_name, cur === ME ? null : ME)}
                          >me</button
                        >
                      </span>
                    {:else}
                      <FieldInput
                        id={`def-${f.reference_name}`}
                        spec={f}
                        label={`Default for ${labelOf(raw, f)}`}
                        value={fc?.default && "value" in fc.default ? fc.default.value : null}
                        form={raw}
                        onchange={(v) => setDefault(f.reference_name, v)}
                      />
                    {/if}
                    {#if src != null && !fc?.default}
                      <span class="muted src">source: {src}</span>
                    {/if}
                  </span>
                  <span class="order" role="cell">
                    {#if b.key !== "out"}
                      <button class="tiny" aria-label={`Move ${labelOf(raw, f)} up`} disabled={i === 0} onclick={() => move(b, f.reference_name, -1)}><Icon name="moveUp" size="0.8em" /></button>
                      <button class="tiny" aria-label={`Move ${labelOf(raw, f)} down`} disabled={i === b.fields.length - 1} onclick={() => move(b, f.reference_name, 1)}><Icon name="moveDown" size="0.8em" /></button>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <label class="guidance">
          <span class="label">guidance for tachy's review of a {type}</span>
          <textarea
            rows="3"
            placeholder="e.g. always ask for the customer's MES version"
            value={tc.guidance ?? ""}
            oninput={(e) => setTc({ ...tc, guidance: (e.target as HTMLTextAreaElement).value || undefined })}
          ></textarea>
        </label>
      {/if}
    {/if}
  </section>
</div>

<style>
  .flows {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
    gap: var(--pad-4);
    height: 100%;
  }
  .projects,
  .editor {
    min-height: 0;
    overflow-y: auto;
  }
  .projects {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    padding-right: var(--pad-3);
    border-right: 1px dashed var(--border);
  }
  .head,
  .label,
  .blockhead {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  .proj {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: var(--pad-2);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .proj:hover,
  .proj:focus-visible {
    border-color: var(--border);
  }
  .proj.active {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .bad {
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
    padding-bottom: var(--pad-4);
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-2);
    padding-bottom: var(--pad-2);
    border-bottom: 1px dashed var(--border);
    background: var(--panel-solid);
  }
  .title {
    display: flex;
    flex-direction: column;
  }
  .crumb {
    color: var(--accent);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .types {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2);
  }
  .type {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-chip);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
  }
  .type.current {
    border-color: var(--accent);
  }
  .type.off {
    color: var(--muted);
    border-style: dashed;
    cursor: pointer;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    padding: 0 0.2rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .glyph {
    display: inline-flex;
  }
  .tiny {
    display: inline-flex;
    padding: 0.1rem;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .tiny:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .tiny:not(:disabled):hover {
    color: var(--accent);
  }
  .link {
    border: none;
    background: none;
    color: var(--muted);
    font-size: var(--fs-sm);
    text-decoration: underline dotted;
    cursor: pointer;
  }
  .table {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(12rem, 1.3fr) minmax(11rem, 0.9fr) minmax(12rem, 1.4fr) 3.5rem;
    align-items: center;
    gap: var(--pad-2);
    padding: 0.2rem 0;
  }
  .headrow {
    font-size: var(--fs-xs);
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .block {
    display: flex;
    flex-direction: column;
  }
  .blockhead {
    padding: var(--pad-1) 0;
    border-bottom: 1px dashed var(--border);
  }
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1);
    min-width: 0;
  }
  .ref {
    width: 100%;
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .def {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .src {
    font-size: var(--fs-xs);
  }
  .person {
    display: flex;
    align-items: center;
    gap: var(--pad-1);
  }
  .person > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
  .me {
    flex: none;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-chip);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .me:hover,
  .me:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .me.on {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text);
  }
  .order {
    display: inline-flex;
    gap: 0.1rem;
  }
  .guidance {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .guidance textarea {
    width: 100%;
    resize: vertical;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
