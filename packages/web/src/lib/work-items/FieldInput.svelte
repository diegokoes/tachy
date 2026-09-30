<script lang="ts">
  import type { ComposerForm, FieldSpec } from "@tachy/contract";
  import { Checkbox, Select } from "../tui";
  import { AREA, ITERATION } from "./layout";

  let {
    id,
    spec,
    label,
    value,
    form,
    invalid = false,
    onchange,
  }: {
    id: string;
    spec: FieldSpec;
    /** What ADO's form calls it. */
    label: string;
    value: unknown;
    form: ComposerForm;
    invalid?: boolean;
    onchange: (v: unknown) => void;
  } = $props();

  type Kind =
    | "path"
    | "person"
    | "multi"
    | "suggest"
    | "choice"
    | "bool"
    | "number"
    | "date"
    | "text"
    | "line";

  const widget = $derived(form.widgets[spec.reference_name]);

  const kind = $derived.by<Kind>(() => {
    if (widget) return widget.kind;
    if (
      spec.reference_name === AREA ||
      spec.reference_name === ITERATION ||
      spec.type === "treePath"
    )
      return "path";
    if (spec.is_identity || spec.type === "identity") return "person";
    if (spec.allowed_values?.length) return "choice";
    switch (spec.type) {
      case "boolean":
        return "bool";
      case "integer":
      case "double":
        return "number";
      case "dateTime":
        return "date";
      case "plainText":
        return "text";
      default:
        return "line";
    }
  });

  const current = $derived(value == null ? "" : String(value));

  type Opt = { value: string; label: string; hint?: string };

  /** A prefilled or templated value the lists do not carry still has to show. */
  const withCurrent = (opts: Opt[]): Opt[] =>
    current && !opts.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...opts]
      : opts;

  /** Every path starts with the project; saying it on each row is noise. */
  const shortPath = (path: string) =>
    path === form.project
      ? `${form.project} (root)`
      : path.startsWith(`${form.project}\\`)
        ? path.slice(form.project.length + 1)
        : path;

  const pathOptions = $derived(
    withCurrent(
      (spec.reference_name === ITERATION ? form.iterations : form.areas).map(
        (p) => ({
          value: p.path,
          label: shortPath(p.path),
          hint: p.current ? "current" : p.team ? "team" : undefined,
        }),
      ),
    ),
  );

  let typingPerson = $state(false);
  const OTHER = "__other__";
  const isMe = (unique: string) =>
    !!form.me && unique.toLowerCase() === form.me.unique_name.toLowerCase();
  const personOptions = $derived([
    { value: "", label: "(nobody)" },
    ...withCurrent(
      form.people.map((p) => ({
        value: p.unique_name,
        label: isMe(p.unique_name) ? `me · ${p.name}` : p.name,
        hint: p.unique_name,
      })),
    ),
    { value: OTHER, label: "someone else: type their email…" },
  ]);

  const choiceOptions = $derived([
    ...(spec.required ? [] : [{ value: "", label: "(none)" }]),
    ...withCurrent(
      (spec.allowed_values ?? []).map((v) => ({
        value: String(v),
        label: String(v),
      })),
    ),
  ]);

  /** Allowed values arrive as strings or numbers; send back what ADO listed. */
  function pickChoice(v: string) {
    const original = spec.allowed_values?.find((a) => String(a) === v);
    onchange(v === "" ? null : (original ?? v));
  }

  /* The multivalue extension stores its picks as one ";"-joined string. */
  const picked = $derived(
    current
      .split(";")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  const multiValues = $derived(
    widget?.kind === "multi"
      ? [...widget.values, ...picked.filter((p) => !widget.values.includes(p))]
      : [],
  );
  function toggle(v: string) {
    const next = picked.includes(v)
      ? picked.filter((p) => p !== v)
      : [...picked, v];
    onchange(next.length ? next.join(";") : null);
  }
  let custom = $state("");
  function addCustom() {
    const v = custom.trim();
    if (v && !picked.includes(v)) onchange([...picked, v].join(";"));
    custom = "";
  }
</script>

{#if kind === "path"}
  <Select
    value={current}
    options={pathOptions}
    searchable
    aria-label={label}
    onchange={(v) => onchange(String(v))}
  />
{:else if kind === "person"}
  <div class="person">
    {#if typingPerson}
      <input
        {id}
        class:invalid
        type="email"
        placeholder="name@company.com"
        value={current}
        aria-label={label}
        onchange={(e) =>
          onchange((e.target as HTMLInputElement).value.trim() || null)}
        onkeydown={(e) => e.key === "Escape" && (typingPerson = false)}
      />
    {:else}
      <Select
        value={current}
        options={personOptions}
        searchable
        aria-label={label}
        onchange={(v) =>
          v === OTHER ? (typingPerson = true) : onchange(String(v) || null)}
      />
    {/if}
    {#if form.me && !isMe(current)}
      <button
        class="me"
        title={`set to ${form.me.name}`}
        onclick={() => {
          typingPerson = false;
          onchange(form.me!.unique_name);
        }}>me</button
      >
    {/if}
  </div>
{:else if kind === "multi" && widget?.kind === "multi"}
  <div class="multi" role="group" aria-label={label}>
    {#each multiValues as v (v)}
      <button
        class="opt"
        class:on={picked.includes(v)}
        aria-pressed={picked.includes(v)}
        onclick={() => toggle(v)}>{v}</button
      >
    {/each}
    {#if widget.allow_custom}
      <input
        class="custom"
        placeholder="other…"
        aria-label={`Another ${label}`}
        bind:value={custom}
        onkeydown={(e) =>
          e.key === "Enter" && (e.preventDefault(), addCustom())}
        onblur={addCustom}
      />
    {/if}
  </div>
{:else if kind === "suggest"}
  <input
    {id}
    class:invalid
    list={`${id}-list`}
    value={current}
    aria-label={label}
    placeholder="type it"
    oninput={(e) => onchange((e.target as HTMLInputElement).value || null)}
  />
  {#if widget?.kind === "suggest" && widget.values.length}
    <datalist id={`${id}-list`}>
      {#each widget.values as v (v)}<option value={v}></option>{/each}
    </datalist>
  {/if}
{:else if kind === "choice"}
  <Select
    value={current}
    options={choiceOptions}
    aria-label={label}
    onchange={(v) => pickChoice(String(v))}
  />
{:else if kind === "bool"}
  <Checkbox
    checked={value === true}
    ariaLabel={label}
    onchange={(c) => onchange(c)}
  />
{:else if kind === "number"}
  <input
    {id}
    class:invalid
    type="number"
    step={spec.type === "double" ? "any" : "1"}
    value={current}
    aria-label={label}
    oninput={(e) => {
      const raw = (e.target as HTMLInputElement).value;
      onchange(raw === "" ? null : Number(raw));
    }}
  />
{:else if kind === "date"}
  <input
    {id}
    class:invalid
    type="date"
    value={current.slice(0, 10)}
    aria-label={label}
    onchange={(e) => onchange((e.target as HTMLInputElement).value || null)}
  />
{:else if kind === "text"}
  <textarea
    {id}
    class:invalid
    rows="3"
    value={current}
    aria-label={label}
    oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
  ></textarea>
{:else}
  <input
    {id}
    class:invalid
    value={current}
    aria-label={label}
    placeholder={spec.reference_name === "System.Tags"
      ? "tag; another tag"
      : ""}
    oninput={(e) => onchange((e.target as HTMLInputElement).value)}
  />
{/if}

<style>
  input,
  textarea {
    width: 100%;
  }
  .invalid {
    border-color: var(--danger);
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
  .me,
  .opt {
    flex: none;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-chip);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .me:hover,
  .me:focus-visible,
  .opt:hover,
  .opt:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .opt.on {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--text);
  }
  .multi {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1);
  }
  .custom {
    width: 6rem;
  }
</style>
