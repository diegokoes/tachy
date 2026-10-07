<script lang="ts">
  import type { FlowOption } from "@tachy/contract";
  import { Checkbox, Field, Select } from "../tui";
  import AdoFields from "./AdoFields.svelte";
  import OptionList from "./OptionList.svelte";
  import OptionSelect from "./OptionSelect.svelte";
  import type { Schema } from "./schema";

  let {
    schema,
    value,
    variables = [],
    context = {},
    onchange,
  }: {
    schema: Schema;
    value: Record<string, unknown>;
    /** What `{{…}}` can name at this step. */
    variables?: FlowOption[];
    /** What every option source may read, such as the flow's connection. */
    context?: Record<string, string>;
    onchange: (next: Record<string, unknown>) => void;
  } = $props();

  const fields = $derived(Object.entries(schema.properties ?? {}));
  const required = $derived(new Set(schema.required ?? []));

  function set(name: string, entered: unknown) {
    const next = { ...value };
    if (entered === undefined || entered === "") delete next[name];
    else next[name] = entered;
    onchange(next);
  }

  const text = (name: string) => {
    const held = value[name];
    return held == null
      ? ""
      : typeof held === "string"
        ? held
        : JSON.stringify(held);
  };
  const LONG = new Set(["body", "prompt", "material", "note"]);
  const kindOf = (p: Schema) => (Array.isArray(p.type) ? p.type[0] : p.type);

  const depsOf = (p: Schema) => ({
    ...context,
    ...Object.fromEntries(
      (p["x-depends-on"] ?? []).map((d) => [d, text(d)] as const),
    ),
  });
  const titleOf = (name: string, p: Schema) => p.title ?? name;
  const infoOf = (p: Schema) =>
    [
      p.description,
      p.default !== undefined &&
      p.default !== "" &&
      typeof p.default !== "object"
        ? `default: ${p.default}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
  const listOf = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)];

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

{#each fields as [name, property] (name)}
  {@const kind = kindOf(property)}
  {#if property["x-form"] === "ado"}
    <Field label={titleOf(name, property)} info={infoOf(property)} plain>
      <AdoFields
        project={text("project")}
        type={text("type")}
        value={(value[name] as Record<string, unknown>) ?? {}}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if property["x-options"] && kind === "array"}
    <Field
      label={titleOf(name, property)}
      required={required.has(name)}
      info={infoOf(property) ??
        (property["x-free"] ? "pick or type one, Enter adds it" : undefined)}
      plain
    >
      <OptionList
        source={property["x-options"]}
        deps={depsOf(property)}
        value={listOf(value[name])}
        free={property["x-free"]}
        label={titleOf(name, property)}
        onchange={(v) => set(name, v.length ? v : undefined)}
      />
    </Field>
  {:else if property["x-options"]}
    <Field
      label={titleOf(name, property)}
      required={required.has(name)}
      info={infoOf(property)}
    >
      <OptionSelect
        source={property["x-options"]}
        deps={depsOf(property)}
        needs={property["x-depends-on"] ?? []}
        value={text(name)}
        free={property["x-free"]}
        label={titleOf(name, property)}
        onchange={(v) => set(name, v || undefined)}
      />
    </Field>
  {:else if property.enum}
    <Field label={titleOf(name, property)} info={infoOf(property)}>
      <Select
        value={String(value[name] ?? property.default ?? "")}
        options={property.enum.map((v) => ({
          value: String(v),
          label: String(v),
        }))}
        aria-label={titleOf(name, property)}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if kind === "boolean"}
    <Field label={titleOf(name, property)} info={infoOf(property)} inline>
      <Checkbox
        checked={Boolean(value[name] ?? property.default)}
        ariaLabel={name}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if kind === "number" || kind === "integer"}
    <Field
      label={titleOf(name, property)}
      required={required.has(name)}
      info={infoOf(property)}
    >
      <input
        value={text(name)}
        oninput={(e) => set(name, numberish(e.currentTarget.value))}
      />
    </Field>
  {:else if kind === "array"}
    <Field
      label={titleOf(name, property)}
      info={infoOf(property) ?? "separated by commas"}
    >
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
  {:else if kind === "object"}
    <Field label={titleOf(name, property)} info={infoOf(property) ?? "as JSON"}>
      <textarea
        rows="4"
        class="mono"
        value={text(name)}
        oninput={(e) => set(name, parseJson(e.currentTarget.value))}></textarea>
    </Field>
  {:else}
    <Field
      label={titleOf(name, property)}
      required={required.has(name)}
      info={infoOf(property)}
      plain
    >
      <div class="textual">
        {#if LONG.has(name)}
          <textarea
            rows="5"
            aria-label={titleOf(name, property)}
            value={text(name)}
            oninput={(e) => set(name, e.currentTarget.value)}></textarea>
        {:else}
          <input
            aria-label={titleOf(name, property)}
            value={text(name)}
            oninput={(e) => set(name, e.currentTarget.value)}
          />
        {/if}
        {#if variables.length}
          <span class="vars">
            <Select
              value=""
              options={variableOptions}
              searchable
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
