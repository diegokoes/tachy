<script lang="ts">
  import type { FlowOption } from "@tachy/contract";
  import { Checkbox, Field, Select } from "../tui";
  import AdoFields from "./AdoFields.svelte";
  import OptionSelect from "./OptionSelect.svelte";
  import type { Schema } from "./schema";

  let {
    schema,
    value,
    variables = [],
    onchange,
  }: {
    schema: Schema;
    value: Record<string, unknown>;
    /** What `{{…}}` can name at this step. */
    variables?: FlowOption[];
    onchange: (next: Record<string, unknown>) => void;
  } = $props();

  const fields = $derived(Object.entries(schema.properties ?? {}));
  const required = $derived(new Set(schema.required ?? []));

  function set(name: string, v: unknown) {
    const next = { ...value };
    if (v === undefined || v === "") delete next[name];
    else next[name] = v;
    onchange(next);
  }

  const text = (name: string) => {
    const v = value[name];
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  };
  const LONG = new Set(["body", "prompt", "material", "note"]);
  const kindOf = (p: Schema) => (Array.isArray(p.type) ? p.type[0] : p.type);

  const depsOf = (p: Schema) =>
    Object.fromEntries(
      (p["x-depends-on"] ?? []).map((d) => [d, text(d)] as const),
    );

  /** A number, unless it is a template, which fills in at run time. */
  const numberish = (raw: string): unknown =>
    raw.trim() === ""
      ? undefined
      : /^-?\d+(\.\d+)?$/.test(raw.trim())
        ? Number(raw)
        : raw;

  function parseJson(raw: string): unknown {
    if (!raw.trim()) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  const variableOptions = $derived([
    { value: "", label: "insert {{…}}" },
    ...variables.map((v) => ({ ...v, value: `{{${v.value}}}` })),
  ]);
</script>

{#each fields as [name, p] (name)}
  {@const t = kindOf(p)}
  {#if p["x-form"] === "ado"}
    <Field label={name} info={p.description} plain>
      <AdoFields
        project={text("project")}
        type={text("type")}
        value={(value[name] as Record<string, unknown>) ?? {}}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if p["x-options"]}
    <Field label={name} required={required.has(name)} info={p.description}>
      <OptionSelect
        source={p["x-options"]}
        deps={depsOf(p)}
        needs={p["x-depends-on"] ?? []}
        value={text(name)}
        free={p["x-free"]}
        label={name}
        onchange={(v) => set(name, v || undefined)}
      />
    </Field>
  {:else if p.enum}
    <Field label={name} info={p.description}>
      <Select
        value={String(value[name] ?? p.default ?? "")}
        options={p.enum.map((v) => ({ value: String(v), label: String(v) }))}
        aria-label={name}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if t === "boolean"}
    <Field label={name} info={p.description} inline>
      <Checkbox
        checked={Boolean(value[name] ?? p.default)}
        ariaLabel={name}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if t === "number" || t === "integer"}
    <Field label={name} required={required.has(name)} info={p.description}>
      <input
        value={text(name)}
        placeholder={p.default !== undefined ? String(p.default) : ""}
        oninput={(e) => set(name, numberish(e.currentTarget.value))}
      />
    </Field>
  {:else if t === "array"}
    <Field label={name} info={p.description ?? "separated by commas"}>
      <input
        value={Array.isArray(value[name])
          ? (value[name] as unknown[]).join(", ")
          : text(name)}
        oninput={(e) => {
          const raw = e.currentTarget.value;
          set(
            name,
            raw.includes("{{")
              ? raw
              : raw
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
          );
        }}
      />
    </Field>
  {:else if t === "object"}
    <Field label={name} info={p.description ?? "as JSON"}>
      <textarea
        rows="4"
        class="mono"
        value={text(name)}
        oninput={(e) => set(name, parseJson(e.currentTarget.value))}></textarea>
    </Field>
  {:else}
    <Field
      label={name}
      required={required.has(name)}
      info={p.description}
      plain
    >
      <div class="textual">
        {#if LONG.has(name)}
          <textarea
            rows="5"
            aria-label={name}
            value={text(name)}
            placeholder={p.default !== undefined ? String(p.default) : ""}
            oninput={(e) => set(name, e.currentTarget.value)}></textarea>
        {:else}
          <input
            aria-label={name}
            value={text(name)}
            placeholder={p.default !== undefined ? String(p.default) : ""}
            oninput={(e) => set(name, e.currentTarget.value)}
          />
        {/if}
        {#if variables.length}
          <span class="vars">
            <Select
              value=""
              options={variableOptions}
              searchable
              filterPlaceholder="item.title, steps.…"
              aria-label={`Insert a value into ${name}`}
              onchange={(v) => {
                if (v) set(name, `${text(name)}${v}`);
              }}
            />
          </span>
        {/if}
      </div>
    </Field>
  {/if}
{/each}

<style>
  .textual {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
  .textual textarea,
  .textual input,
  textarea {
    width: 100%;
    resize: vertical;
  }
  .vars {
    align-self: flex-end;
    width: 11rem;
  }
  .vars > :global(*) {
    width: 100%;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
</style>
