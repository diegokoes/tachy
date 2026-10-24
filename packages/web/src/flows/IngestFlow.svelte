<script lang="ts">
  import {
    INGEST_MESSAGE_FIELDS,
    type FlowOption,
    type IngestConfig,
    type IngestFieldMode,
    type IngestPreview,
    type IngestRule,
  } from "@tachy/contract";
  import { api } from "../api";
  import { isGlobalAdmin } from "../access/session.svelte";
  import { setPageActions } from "../admin/pageActions.svelte";
  import Choice from "../settings/Choice.svelte";
  import Group from "../settings/Group.svelte";
  import Row from "../settings/Row.svelte";
  import Rows from "../settings/Rows.svelte";
  import { Badge, Button, Checkbox, Icon, Note, Select, tip } from "../tui";
  import ConditionEditor from "./ConditionEditor.svelte";
  import OptionList from "./OptionList.svelte";
  import OptionSelect from "./OptionSelect.svelte";
  import { fetchOptions } from "./options.svelte";

  let { connection }: { connection: string } = $props();

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const PREVIEW_DEBOUNCE_MS = 300;
  const CHARS_PER_TOKEN = 4;
  const path = $derived(`/flows/ingest/${encodeURIComponent(connection)}`);

  let config = $state<IngestConfig>({});
  let saved = $state("{}");
  let loadError = $state<string | null>(null);
  $effect(() => {
    const requested = path;
    loadError = null;
    addedGroups = [];
    api
      .get<IngestConfig>(requested)
      .then((loaded) => {
        if (requested !== path) return;
        config = loaded ?? {};
        saved = JSON.stringify(config);
      })
      .catch((e) => (loadError = errText(e)));
  });

  const dirty = $derived(JSON.stringify(config) !== saved);
  /** A connection serves every team, so only an app admin changes it. */
  const canEdit = $derived(isGlobalAdmin());

  const rules = $derived(config.skip ?? []);
  function setRules(next: IngestRule[]) {
    config = { ...config, skip: next.length ? next : undefined };
  }
  function setRule(at: number, patch: Partial<IngestRule>) {
    setRules(rules.map((rule, i) => (i === at ? { ...rule, ...patch } : rule)));
  }
  function addRule() {
    setRules([
      ...rules,
      {
        id: `rule-${Math.random().toString(36).slice(2, 8)}`,
        label: "",
        enabled: true,
        where: { all: [{ field: "message.author", op: "eq", value: "" }] },
      },
    ]);
  }

  type FieldsMode = "all" | IngestFieldMode;
  const FIELD_MODES: { value: FieldsMode; label: string }[] = [
    { value: "all", label: "all" },
    { value: "only", label: "only these" },
    { value: "except", label: "all but these" },
  ];
  const fieldsMode = $derived<FieldsMode>(config.fields?.mode ?? "all");
  function setFields(mode: FieldsMode, paths: string[]) {
    config = {
      ...config,
      fields: mode === "all" ? undefined : { mode, paths },
    };
  }

  let groups = $state<FlowOption[]>([]);
  let groupsError = $state<string | null>(null);
  $effect(() => {
    groupsError = null;
    fetchOptions("source.groups", { connection })
      .then((loaded) => (groups = loaded))
      .catch((e) => {
        groups = [];
        groupsError = errText(e);
      });
  });
  /** Groups added here whose guidance is still empty, so not yet in `config`. */
  let addedGroups = $state<string[]>([]);
  const guidedGroups = $derived([
    ...Object.keys(config.guidance ?? {}),
    ...addedGroups.filter((key) => !config.guidance?.[key]),
  ]);
  const groupLabel = (key: string) =>
    groups.find((g) => g.value === key)?.label ?? key;
  const unguidedGroups = $derived(
    groups.filter((g) => !guidedGroups.includes(g.value)),
  );
  function addGroup(key: string) {
    if (key && !guidedGroups.includes(key)) addedGroups = [...addedGroups, key];
  }
  function removeGroup(key: string) {
    addedGroups = addedGroups.filter((added) => added !== key);
    setGuidance(key, "");
  }
  function setGuidance(group: string, text: string) {
    const guidance = { ...(config.guidance ?? {}) };
    if (text.trim()) guidance[group] = text;
    else delete guidance[group];
    config = {
      ...config,
      guidance: Object.keys(guidance).length ? guidance : undefined,
    };
  }

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  async function save() {
    saving = true;
    saveError = null;
    try {
      config = await api.put<IngestConfig>(path, config);
      saved = JSON.stringify(config);
    } catch (e) {
      saveError = errText(e);
    } finally {
      saving = false;
    }
  }

  let previewItem = $state("");
  let preview = $state<IngestPreview | null>(null);
  let previewError = $state<string | null>(null);
  $effect(() => {
    const itemId = previewItem;
    const draft = JSON.stringify(config);
    const previewPath = `${path}/preview`;
    previewError = null;
    if (!itemId) {
      preview = null;
      return;
    }
    const timer = setTimeout(() => {
      api
        .post<IngestPreview>(previewPath, {
          work_item_id: itemId,
          config: JSON.parse(draft),
        })
        .then((shown) => {
          if (itemId === previewItem) preview = shown;
        })
        .catch((e) => (previewError = errText(e)));
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });
  const readCount = $derived(
    preview?.messages.filter((m) => !m.skipped_by).length ?? 0,
  );
  const ruleName = (id: string) =>
    rules.find((rule) => rule.id === id)?.label || "a rule";
  const tokens = (chars: number) =>
    Math.round(chars / CHARS_PER_TOKEN).toLocaleString();

  $effect(() => setPageActions(actions));
</script>

{#snippet actions()}
  <Button
    variant="ghost"
    size="sm"
    icon="save"
    tone={dirty ? "accent" : undefined}
    busy={saving}
    disabled={!dirty || !canEdit}
    onclick={save}>save</Button
  >
{/snippet}

{#if loadError}
  <Note tone="danger">{loadError}</Note>
{:else}
  {#if saveError}<Note tone="danger">{saveError}</Note>{/if}
  {#if !canEdit}
    <Note>only an app admin changes how this source's tickets read</Note>
  {/if}

  <Group label="skip messages" icon="eyeClosed">
    <div class="rules">
      {#each rules as rule, i (rule.id)}
        <div class="rule" class:off={!rule.enabled}>
          <div class="head">
            <Checkbox
              checked={rule.enabled}
              ariaLabel={`rule ${rule.label || i + 1} applies`}
              onchange={(on) => setRule(i, { enabled: on })}
            />
            <input
              class="name"
              aria-label="rule name"
              value={rule.label}
              oninput={(e) => setRule(i, { label: e.currentTarget.value })}
            />
            <button
              class="tiny"
              aria-label="remove this rule"
              use:tip={"remove this rule"}
              onclick={() => setRules(rules.filter((_, j) => j !== i))}
              ><Icon name="close" size="0.85em" /></button
            >
          </div>
          <ConditionEditor
            value={rule.where}
            {connection}
            fields={INGEST_MESSAGE_FIELDS}
            fieldSource="ingest.fields"
            defaultField="message.author"
            valueSource="ingest.values"
            valuePrefixes={["item.", "message."]}
            onchange={(where) => setRule(i, { where })}
          />
        </div>
      {/each}
      <button class="add" onclick={addRule}
        ><Icon name="plus" size="0.85em" /> rule</button
      >
    </div>
  </Group>

  <Group label="ticket fields" icon="fileTypes">
    <Rows>
      <Row label="sent">
        <Choice
          label="which ticket fields are sent"
          options={FIELD_MODES}
          value={fieldsMode}
          onpick={(mode) => setFields(mode, config.fields?.paths ?? [])}
        />
      </Row>
    </Rows>
    {#if fieldsMode !== "all"}
      <OptionList
        source="source.ticket_fields"
        deps={{ connection }}
        free
        value={config.fields?.paths ?? []}
        label={fieldsMode === "only" ? "fields sent" : "fields left out"}
        onchange={(paths) => setFields(fieldsMode, paths)}
      />
    {/if}
  </Group>

  <Group label="guidance" icon="guidance">
    {#if groupsError}<Note tone="danger">{groupsError}</Note>{/if}
    {#each guidedGroups as key (key)}
      <div class="guide">
        <span class="head">
          <span class="group-name">{groupLabel(key)}</span>
          <button
            class="tiny"
            aria-label={`remove the guidance for ${groupLabel(key)}`}
            use:tip={"remove"}
            onclick={() => removeGroup(key)}
            ><Icon name="close" size="0.85em" /></button
          >
        </span>
        <textarea
          class="guidance"
          rows="3"
          aria-label={`guidance for ${groupLabel(key)}`}
          value={config.guidance?.[key] ?? ""}
          oninput={(e) => setGuidance(key, e.currentTarget.value)}></textarea>
      </div>
    {/each}
    <span class="pick">
      {#key guidedGroups.length}
        <Select
          value=""
          options={unguidedGroups}
          searchable
          creatable
          placeholder="add a group"
          aria-label="add guidance for a group"
          onchange={(v) => addGroup(String(v ?? ""))}
        />
      {/key}
    </span>
  </Group>

  <Group label="test" icon="run">
    <span class="pick">
      <OptionSelect
        source="work_items"
        deps={{ connection }}
        value={previewItem}
        placeholder="none"
        label="ticket"
        onchange={(v) => (previewItem = v)}
      />
    </span>
    {#if previewError}
      <Note tone="danger">{previewError}</Note>
    {:else if preview}
      <p class="sum">
        {readCount} of {preview.messages.length} messages read · about {tokens(
          preview.chars.read,
        )} of {tokens(preview.chars.stored)} tokens
      </p>
      <ol class="thread">
        {#each preview.messages as message (message.key)}
          <li class:skipped={!!message.skipped_by}>
            <span class="who"
              >{message.author_label ?? message.author ?? message.direction} · {message.visibility}</span
            >
            {#if message.skipped_by}
              <Badge tone="warn">skipped · {ruleName(message.skipped_by)}</Badge
              >
            {/if}
            <span class="text">{message.excerpt}</span>
          </li>
        {/each}
      </ol>
      {#if preview.guidance}
        <p class="sum">with guidance: {preview.guidance}</p>
      {/if}
    {/if}
  </Group>
{/if}

<style>
  .rules {
    display: flex;
    flex-direction: column;
    gap: var(--pad-3);
  }
  .rule {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  .rule.off :global(.group),
  .rule.off :global(.leaf) {
    opacity: 0.5;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    max-width: 24rem;
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
  .tiny:hover,
  .tiny:focus-visible {
    color: var(--accent);
  }
  .add {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .add:hover {
    color: var(--text);
  }
  .guide {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    margin-bottom: var(--pad-3);
  }
  .group-name {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  .guidance {
    width: 40rem;
    max-width: 100%;
    font: inherit;
  }
  .pick {
    display: block;
    width: 18rem;
    max-width: 100%;
  }
  .pick > :global(*) {
    width: 100%;
  }
  .sum {
    margin: var(--pad-2) 0;
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .thread {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .thread li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--pad-1) var(--pad-2);
    padding: var(--pad-2);
    border-left: 2px solid var(--border);
  }
  .thread li.skipped {
    border-left-color: var(--warn);
  }
  .thread li.skipped .text {
    color: var(--muted);
    text-decoration: line-through;
  }
  .who {
    color: var(--muted);
    font-size: var(--fs-sm);
  }
  .text {
    flex-basis: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
