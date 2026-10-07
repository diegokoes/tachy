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
      .then((loaded) => {
        projects = loaded;
        if (!loaded.some((x) => x.id === projectId))
          projectId = loaded[0]?.id ?? "";
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
  let config = $state<ComposeConfig>({});
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
      .then(([loadedTypes, loadedConfig]) => {
        if (id !== projectId) return;
        types = loadedTypes;
        config = loadedConfig ?? {};
        saved = JSON.stringify(config);
        type = offered[0] ?? loadedTypes[0]?.name ?? "";
      })
      .catch((e) => (loadError = errText(e)));
  });

  let raw = $state<ComposerForm | null>(null);
  let formError = $state<string | null>(null);
  $effect(() => {
    const id = projectId;
    const forType = type;
    raw = null;
    formError = null;
    if (!id || !forType) return;
    api
      .get<ComposerForm>(
        `/compose/projects/${id}/form?type=${encodeURIComponent(forType)}&raw=1`,
      )
      .then((loaded) => {
        if (id === projectId && forType === type) raw = loaded;
      })
      .catch((e) => (formError = errText(e)));
  });

  const dirty = $derived(JSON.stringify(config) !== saved);

  /** Every type, while the team has not picked; its pick in its order after. */
  const offered = $derived(
    config.types?.length ? config.types : types.map((t) => t.name),
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
    config = { ...config, types: next };
  }
  function toggleType(name: string) {
    if (offered.includes(name)) {
      if (offered.length > 1) setTypes(offered.filter((n) => n !== name));
    } else setTypes([...offered, name]);
  }
  function moveType(name: string, by: -1 | 1) {
    const order = [...offered];
    const from = order.indexOf(name);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    setTypes(order);
  }

  const typeConfig = $derived<TypeFormConfig>(config.forms?.[type] ?? {});

  function setTc(next: TypeFormConfig) {
    const forms = { ...(config.forms ?? {}) };
    const empty =
      !Object.keys(next.fields ?? {}).length &&
      !next.order?.length &&
      !next.guidance?.trim();
    if (empty) delete forms[type];
    else forms[type] = next;
    config = { ...config, forms };
  }

  function setField(ref: string, patch: Partial<FieldFormConfig>) {
    const fields = { ...(typeConfig.fields ?? {}) };
    const next: FieldFormConfig = { ...(fields[ref] ?? {}), ...patch };
    if (!next.show) delete next.show;
    if (!next.default) delete next.default;
    if (Object.keys(next).length) fields[ref] = next;
    else delete fields[ref];
    setTc({ ...typeConfig, fields });
  }

  /** The form as the composer will draw it with the config as it stands now. */
  const effective = $derived.by(() => {
    if (!raw) return null;
    const prefill = { ...raw.prefill };
    const show: Record<string, "form" | "fold" | "hidden"> = {};
    for (const [ref, fieldConfig] of Object.entries(typeConfig.fields ?? {})) {
      if (fieldConfig.show) show[ref] = fieldConfig.show;
      if (fieldConfig.default)
        prefill[ref] = {
          value:
            "macro" in fieldConfig.default
              ? fieldConfig.default.macro
              : fieldConfig.default.value,
          origin: "admin",
        };
    }
    return arrange({
      ...raw,
      prefill,
      display: { show, order: typeConfig.order ?? [] },
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
    const laidOut: Block[] = [
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
    return laidOut.filter((b) => b.fields.length);
  });

  /** Order is the drawn order, read back after a move within one block. */
  function move(block: Block, ref: string, by: -1 | 1) {
    const from = block.fields.findIndex((f) => f.reference_name === ref);
    const to = from + by;
    if (from < 0 || to < 0 || to >= block.fields.length) return;
    const order = blocks.flatMap((b) => {
      const refs = b.fields.map((f) => f.reference_name);
      if (b.key === block.key) [refs[from], refs[to]] = [refs[to], refs[from]];
      return refs;
    });
    setTc({ ...typeConfig, order });
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
    const arranged = arrange(raw);
    return new Set(
      [...arranged.body, ...arranged.groups.flatMap((g) => g.fields)].map(
        (f) => f.reference_name,
      ),
    );
  });

  type Place = "" | "form" | "fold" | "hidden";
  // The first choice names what "no choice" means for this field, which is what
  // the source does with it; the rest are the team overriding that.
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
  const ME_MACRO = "@me";

  /** The value the source starts the field at, before the team's default. */
  const sourceValue = (ref: string): unknown => {
    const prefilled = raw?.prefill[ref];
    return prefilled && prefilled.origin !== "admin"
      ? prefilled.value
      : undefined;
  };
  const hasSource = (ref: string) => {
    const value = sourceValue(ref);
    return value != null && value !== "";
  };

  function adminDefault(ref: string): unknown {
    const configured = typeConfig.fields?.[ref]?.default;
    if (!configured) return undefined;
    return "macro" in configured ? configured.macro : configured.value;
  }
  /** What the field starts as: the team's default, else the source's. */
  const startsAs = (ref: string) => adminDefault(ref) ?? sourceValue(ref);

  /** Picking the source's own value again keeps following the source. */
  function setDefault(ref: string, value: unknown) {
    if (value == null || value === "" || value === sourceValue(ref))
      setField(ref, { default: undefined });
    else if (value === ME_MACRO) setField(ref, { default: { macro: "@me" } });
    else
      setField(ref, { default: { value: value as string | number | boolean } });
  }

  function personOptions(current: string) {
    const people = (raw?.people ?? []).map((p) => ({
      value: p.unique_name,
      label: p.name,
      hint: p.unique_name,
    }));
    return [
      { value: "", label: "(no default)" },
      { value: ME_MACRO, label: "me", hint: "whoever creates it" },
      ...(current &&
      current !== ME_MACRO &&
      !people.some((p) => p.value === current)
        ? [{ value: current, label: current }]
        : []),
      ...people,
    ];
  }

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  async function save() {
    if (!projectId) return;
    saving = true;
    saveError = null;
    try {
      config = await api.put<ComposeConfig>(
        `/compose/projects/${projectId}/config`,
        config,
      );
      saved = JSON.stringify(config);
    } catch (e) {
      saveError = errText(e);
    } finally {
      saving = false;
    }
  }

  function tryIt() {
    const typeOption = typeByName.get(type);
    if (!project || !typeOption) return;
    navigate("/chat");
    openComposer(project, typeOption);
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
          {@const typeOption = typeByName.get(name)}
          <span class="type" class:current={name === type}>
            <button class="name" onclick={() => (type = name)}>
              <span
                class="glyph"
                style:color={typeColor(typeOption?.color) ?? undefined}
              >
                <Icon name={typeIcon(typeOption?.icon)} size="1em" />
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
        {#each unoffered as typeOption (typeOption.name)}
          <button class="type off" onclick={() => toggleType(typeOption.name)}>
            <Icon name="plus" size="0.85em" />
            {typeOption.name}
          </button>
        {/each}
        {#if config.types?.length}
          <button
            class="link"
            onclick={() => (config = { ...config, types: undefined })}
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
      {#each blocks as block (block.key)}
        <Group label={block.title} hint={block.hint}>
          <Rows>
            {#each block.fields as field, i (field.reference_name)}
              {@const ref = field.reference_name}
              {@const label = labelOf(raw, field)}
              {@const own = adminDefault(ref) !== undefined}
              <Row {label}>
                {#snippet mark()}
                  {#if field.required}<Badge tone="warn">required</Badge>{/if}
                {/snippet}
                {#snippet actions()}
                  {#if block.key !== "out"}
                    <span class="order">
                      <button
                        class="tiny"
                        aria-label={`Move ${label} up`}
                        disabled={i === 0}
                        onclick={() => move(block, ref, -1)}
                        ><Icon name="moveUp" size="0.85em" /></button
                      >
                      <button
                        class="tiny"
                        aria-label={`Move ${label} down`}
                        disabled={i === block.fields.length - 1}
                        onclick={() => move(block, ref, 1)}
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
                    value={(typeConfig.fields?.[ref]?.show ?? "") as Place}
                    onpick={(v) =>
                      setField(ref, {
                        show: (v || undefined) as FieldFormConfig["show"],
                      })}
                  />
                {/snippet}
                <div class="field">
                  {#if isPerson(field)}
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
                        class:on={cur === ME_MACRO}
                        aria-pressed={cur === ME_MACRO}
                        onclick={() =>
                          setDefault(ref, cur === ME_MACRO ? null : ME_MACRO)}
                        >me</button
                      >
                    </span>
                  {:else}
                    <FieldInput
                      id={`def-${ref}`}
                      spec={field}
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
          value={typeConfig.guidance ?? ""}
          oninput={(e) =>
            setTc({
              ...typeConfig,
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
