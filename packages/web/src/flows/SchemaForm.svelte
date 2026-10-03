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

{#each fields as [name, p] (name)}
  {@const t = kindOf(p)}
  {#if p["x-form"] === "ado"}
    <Field label={titleOf(name, p)} info={infoOf(p)} plain>
      <AdoFields
        project={text("project")}
        type={text("type")}
        value={(value[name] as Record<string, unknown>) ?? {}}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if p["x-options"] && t === "array"}
    <Field
      label={titleOf(name, p)}
      required={required.has(name)}
      info={infoOf(p) ??
        (p["x-free"] ? "pick or type one, Enter adds it" : undefined)}
      plain
    >
      <OptionList
        source={p["x-options"]}
        deps={depsOf(p)}
        value={listOf(value[name])}
        free={p["x-free"]}
        label={titleOf(name, p)}
        onchange={(v) => set(name, v.length ? v : undefined)}
      />
    </Field>
  {:else if p["x-options"]}
    <Field
      label={titleOf(name, p)}
      required={required.has(name)}
      info={infoOf(p)}
    >
      <OptionSelect
        source={p["x-options"]}
        deps={depsOf(p)}
        needs={p["x-depends-on"] ?? []}
        value={text(name)}
        free={p["x-free"]}
        label={titleOf(name, p)}
        onchange={(v) => set(name, v || undefined)}
      />
    </Field>
  {:else if p.enum}
    <Field label={titleOf(name, p)} info={infoOf(p)}>
      <Select
        value={String(value[name] ?? p.default ?? "")}
        options={p.enum.map((v) => ({ value: String(v), label: String(v) }))}
        aria-label={titleOf(name, p)}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if t === "boolean"}
    <Field label={titleOf(name, p)} info={infoOf(p)} inline>
      <Checkbox
        checked={Boolean(value[name] ?? p.default)}
        ariaLabel={name}
        onchange={(v) => set(name, v)}
      />
    </Field>
  {:else if t === "number" || t === "integer"}
    <Field
      label={titleOf(name, p)}
      required={required.has(name)}
      info={infoOf(p)}
    >
      <input
        value={text(name)}
        oninput={(e) => set(name, numberish(e.currentTarget.value))}
      />
    </Field>
  {:else if t === "array"}
    <Field label={titleOf(name, p)} info={infoOf(p) ?? "separated by commas"}>
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
    <Field label={titleOf(name, p)} info={infoOf(p) ?? "as JSON"}>
      <textarea
        rows="4"
        class="mono"
        value={text(name)}
        oninput={(e) => set(name, parseJson(e.currentTarget.value))}></textarea>
    </Field>
  {:else}
    <Field
      label={titleOf(name, p)}
      required={required.has(name)}
      info={infoOf(p)}
      plain
    >
      <div class="textual">
        {#if LONG.has(name)}
          <textarea
            rows="5"
            aria-label={titleOf(name, p)}
            value={text(name)}
            oninput={(e) => set(name, e.currentTarget.value)}></textarea>
        {:else}
          <input
            aria-label={titleOf(name, p)}
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
