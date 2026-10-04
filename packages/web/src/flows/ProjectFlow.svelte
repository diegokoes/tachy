<script lang="ts">
  import type { Snippet } from "svelte";
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
  import { setPageActions } from "../admin/pageActions.svelte";
  import { keep, recall } from "../shell/kept";
  import { navigate } from "../shell/router.svelte";
  import Choice from "../settings/Choice.svelte";
  import Group from "../settings/Group.svelte";
  import Row from "../settings/Row.svelte";
  import Rows from "../settings/Rows.svelte";
  import {
    Badge,
    Button,
    Icon,
    Note,
    Select,
    tip,
    type IconName,
  } from "../tui";
  import { typeColor, typeIcon } from "../work-items/ado-icons";
  import { openComposer } from "../work-items/composer.svelte";
  import FieldInput from "../work-items/FieldInput.svelte";
  import { arrange, editable, labelOf, TITLE } from "../work-items/layout";

  let { lead }: { lead: Snippet } = $props();

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
  const projectOptions = $derived(
    projects.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.product_slug ?? p.team_slug,
    })),
  );

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
  const typeOptions = $derived(
    types.map((t) => ({
      value: t.name,
      label: t.name,
      hint: offered.includes(t.name) ? undefined : "not offered",
    })),
  );

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
    return arrange({
      ...raw,
      prefill,
      display: { show, order: tc.order ?? [] },
    });
  });

  type Block = {
    key: string;
    title: string;
    hint?: string;
    fields: FieldSpec[];
  };
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
      { key: "body", title: "written", fields: effective.body },
      ...effective.groups.map((g, i) => ({
        key: `g${i}`,
        title: g.label ?? "header",
        hint:
          g.label === "also required"
            ? "nothing fills them, so they stay on screen whatever is set"
            : undefined,
        fields: g.fields,
      })),
      {
        key: "folded",
        title: "folded away",
        hint: "under more fields",
        fields: effective.hidden,
      },
      {
        key: "out",
        title: "left out",
        hint: "never shown; a default is still sent",
        fields: raw.fields.filter(
          (f) =>
            f.reference_name !== TITLE &&
            editable(f) &&
            !drawn.has(f.reference_name),
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
      [...a.body, ...a.groups.flatMap((g) => g.fields)].map(
        (f) => f.reference_name,
      ),
    );
  });

  type Place = "" | "form" | "fold" | "hidden";
  /* The first choice names what "no choice" means for this field, which is
     what the source does with it; the rest are the team overriding that. */
  const placeOptions = (
    ref: string,
  ): { value: Place; label: string; icon: IconName }[] => [
    {
      value: "",
      label: `like ${sourceName} · ${sourceShows.has(ref) ? "shown" : "under more fields"}`,
      icon: "placeAsSource",
    },
    { value: "form", label: "always show", icon: "placePinned" },
    {
      value: "fold",
      label: "fold away · under more fields",
      icon: "placeFolded",
    },
    {
      value: "hidden",
      label: "leave out · its default is still sent",
      icon: "placeOmitted",
    },
  ];

  const isPerson = (f: FieldSpec) => !!f.is_identity || f.type === "identity";
  const ME = "@me";

  /** The value the source starts the field at, before the team's default. */
  const sourceValue = (ref: string): unknown => {
    const p = raw?.prefill[ref];
    return p && p.origin !== "admin" ? p.value : undefined;
  };
  const hasSource = (ref: string) => {
    const v = sourceValue(ref);
    return v != null && v !== "";
  };

  function adminDefault(ref: string): unknown {
    const d = tc.fields?.[ref]?.default;
    if (!d) return undefined;
    return "macro" in d ? d.macro : d.value;
  }
  /** What the field starts as: the team's default, else the source's. */
  const startsAs = (ref: string) => adminDefault(ref) ?? sourceValue(ref);

  /** Picking the source's own value again keeps following the source. */
  function setDefault(ref: string, v: unknown) {
    if (v == null || v === "" || v === sourceValue(ref))
      setField(ref, { default: undefined });
    else if (v === ME) setField(ref, { default: { macro: "@me" } });
    else setField(ref, { default: { value: v as string | number | boolean } });
  }

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

  /* ---- save ---------------------------------------------------------------- */

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  async function save() {
    if (!projectId) return;
    saving = true;
    saveError = null;
    try {
      cfg = await api.put<ComposeConfig>(
        `/compose/projects/${projectId}/config`,
        cfg,
      );
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

  $effect(() => setPageActions(actions));
</script>

{#snippet actions()}
  <Button
    variant="ghost"
    size="sm"
    icon="run"
    disabled={dirty || !raw}
    onclick={tryIt}>try it</Button
  >
  <Button
    variant="ghost"
    size="sm"
    icon="save"
    tone={dirty ? "accent" : undefined}
    busy={saving}
    disabled={!dirty}
    onclick={save}>save</Button
  >
{/snippet}

<header class="bar">
  {@render lead()}
  <span class="pick wide">
    <Select
      value={projectId}
      options={projectOptions}
      searchable
      placeholder="project"
      aria-label="Project"
      onchange={(v) => (projectId = String(v ?? ""))}
    />
  </span>
  {#if types.length}
    <span class="pick">
      <Select
        value={type}
        options={typeOptions}
        searchable
        aria-label="Type"
        onchange={(v) => (type = String(v ?? ""))}
      />
    </span>
  {/if}
</header>

<div class="body">
  {#if saveError}<Note tone="danger">{saveError}</Note>{/if}
  {#if projectsError}
    <Note tone="danger">{projectsError}</Note>
  {:else if !projects.length}
    <Note>No registered projects your teams own.</Note>
  {:else if loadError}
    <Note tone="danger">{loadError}</Note>
  {:else if project}
    <Group label="types offered">
      <div class="chips">
        {#each offered as name, i (name)}
          {@const t = typeByName.get(name)}
          <span class="type" class:current={name === type}>
            <button class="name" onclick={() => (type = name)}>
              <span
                class="glyph"
                style:color={typeColor(t?.color) ?? undefined}
              >
                <Icon name={typeIcon(t?.icon)} size="1em" />
              </span>
              {name}
            </button>
            <button
              class="tiny"
              aria-label={`Move ${name} earlier`}
              disabled={i === 0}
              onclick={() => moveType(name, -1)}
              ><Icon name="moveUp" size="0.85em" /></button
            >
            <button
              class="tiny"
              aria-label={`Move ${name} later`}
              disabled={i === offered.length - 1}
              onclick={() => moveType(name, 1)}
              ><Icon name="moveDown" size="0.85em" /></button
            >
            <button
              class="tiny"
              aria-label={`Stop offering ${name}`}
              disabled={offered.length === 1}
              onclick={() => toggleType(name)}
              ><Icon name="close" size="0.85em" /></button
            >
          </span>
        {/each}
        {#each unoffered as t (t.name)}
          <button class="type off" onclick={() => toggleType(t.name)}>
            <Icon name="plus" size="0.85em" />
            {t.name}
          </button>
        {/each}
        {#if cfg.types?.length}
          <button
            class="link"
            onclick={() => (cfg = { ...cfg, types: undefined })}
            >offer every type</button
          >
        {/if}
      </div>
    </Group>

    {#if formError}
      <Note tone="danger">{formError}</Note>
    {:else if !raw}
      <Note>reading {project.name}'s {type} form…</Note>
    {:else}
      {#each blocks as b (b.key)}
        <Group label={b.title} hint={b.hint}>
          <Rows>
            {#each b.fields as f, i (f.reference_name)}
              {@const ref = f.reference_name}
              {@const label = labelOf(raw, f)}
              {@const own = adminDefault(ref) !== undefined}
              <Row {label}>
                {#snippet mark()}
                  {#if f.required}<Badge tone="warn">required</Badge>{/if}
                {/snippet}
                {#snippet actions()}
                  {#if b.key !== "out"}
                    <span class="order">
                      <button
                        class="tiny"
                        aria-label={`Move ${label} up`}
                        disabled={i === 0}
                        onclick={() => move(b, ref, -1)}
                        ><Icon name="moveUp" size="0.85em" /></button
                      >
                      <button
                        class="tiny"
                        aria-label={`Move ${label} down`}
                        disabled={i === b.fields.length - 1}
                        onclick={() => move(b, ref, 1)}
                        ><Icon name="moveDown" size="0.85em" /></button
                      >
                    </span>
                  {/if}
                  <span class="origin">
                    {#if own}
                      <button
                        class="tiny"
                        aria-label={hasSource(ref)
                          ? `Back to ${sourceName}'s value`
                          : "Clear the default"}
                        use:tip={hasSource(ref)
                          ? `back to ${sourceName}'s value`
                          : "clear the default"}
                        onclick={() => setField(ref, { default: undefined })}
                        ><Icon name="reset" size="0.85em" /></button
                      >
                    {:else if hasSource(ref)}
                      <span class="from">{sourceName}</span>
                    {/if}
                  </span>
                  <Choice
                    label={`Where ${label} shows`}
                    options={placeOptions(ref)}
                    value={(tc.fields?.[ref]?.show ?? "") as Place}
                    onpick={(v) =>
                      setField(ref, {
                        show: (v || undefined) as FieldFormConfig["show"],
                      })}
                  />
                {/snippet}
                <div class="field">
                  {#if isPerson(f)}
                    {@const cur = String(startsAs(ref) ?? "")}
                    <span class="person">
                      <Select
                        value={cur}
                        options={personOptions(cur)}
                        searchable
                        aria-label={`Default for ${label}`}
                        onchange={(v) => setDefault(ref, v)}
                      />
                      <button
                        class="me"
                        class:on={cur === ME}
                        aria-pressed={cur === ME}
                        onclick={() => setDefault(ref, cur === ME ? null : ME)}
                        >me</button
                      >
                    </span>
                  {:else}
                    <FieldInput
                      id={`def-${ref}`}
                      spec={f}
                      label={`Default for ${label}`}
                      value={startsAs(ref) ?? null}
                      form={raw}
                      onchange={(v) => setDefault(ref, v)}
                    />
                  {/if}
                </div>
              </Row>
            {/each}
          </Rows>
        </Group>
      {/each}

      <Group label="guidance" icon="guidance">
        <textarea
          class="guidance"
          rows="4"
          aria-label={`Guidance for tachy's review of a ${type}`}
          value={tc.guidance ?? ""}
          oninput={(e) =>
            setTc({
              ...tc,
              guidance: (e.target as HTMLTextAreaElement).value || undefined,
            })}></textarea>
      </Group>
    {/if}
  {/if}
</div>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-2) var(--pad-3);
    padding: var(--pad-3) 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel-solid);
  }
  .pick {
    width: 12rem;
    max-width: 100%;
  }
  .pick.wide {
    width: 18rem;
  }
  .pick > :global(*) {
    width: 100%;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: calc(var(--pad-4) * 1.5);
    padding-top: var(--pad-4);
    --control-w: 16rem;
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
    gap: 2px;
    min-height: var(--row-h);
    padding: 0 var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
  }
  .type .tiny {
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .type:hover .tiny,
  .type:focus-within .tiny {
    opacity: 1;
  }
  .type.current {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .type.off {
    gap: var(--pad-1);
    color: var(--muted);
    border-style: dashed;
    cursor: pointer;
  }
  .type.off:hover {
    color: var(--text);
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    padding: 0 var(--pad-1);
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
    padding: 3px;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .tiny:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .tiny:not(:disabled):hover,
  .tiny:focus-visible {
    color: var(--accent);
  }
  .link {
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-sm);
    text-decoration: underline dotted;
    cursor: pointer;
  }
  .order {
    display: inline-flex;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  :global(.row:hover) .order,
  .order:focus-within {
    opacity: 1;
  }
  .origin {
    display: inline-flex;
    justify-content: flex-end;
    width: 4.5rem;
  }
  .from {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
    cursor: default;
  }
  .field {
    display: flex;
    min-width: 0;
  }
  .field > :global(*) {
    flex: 1;
    min-width: 0;
  }
  .field :global(textarea) {
    height: var(--control-h);
    min-height: var(--control-h);
    resize: vertical;
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
    min-height: var(--control-h);
    padding: 0 var(--pad-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
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
  .guidance {
    width: 100%;
    resize: vertical;
  }
</style>
