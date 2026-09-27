<script lang="ts">
  import type { ComposerForm, FieldSpec } from "@tachy/contract";
  import { Checkbox, Select } from "../tui";
  import { AREA, ITERATION } from "./layout";

  let {
    id,
    spec,
    value,
    form,
    invalid = false,
    onchange,
  }: {
    id: string;
    spec: FieldSpec;
    value: unknown;
    form: ComposerForm;
    invalid?: boolean;
    onchange: (v: unknown) => void;
  } = $props();

  type Kind = "path" | "person" | "choice" | "bool" | "number" | "date" | "text" | "line";

  const kind = $derived.by<Kind>(() => {
    if (spec.reference_name === AREA || spec.reference_name === ITERATION || spec.type === "treePath")
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

  /** A prefilled or templated value the lists do not carry still has to show. */
  const withCurrent = (opts: { value: string; label: string }[]) =>
    current && !opts.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...opts]
      : opts;

  const pathOptions = $derived(
    withCurrent(
      (spec.reference_name === ITERATION ? form.iterations : form.areas).map((p) => ({
        value: p.path,
        label: `${p.path}${p.current ? "  · current" : p.team ? "  · team" : ""}`,
      })),
    ),
  );

  let typingPerson = $state(false);
  const OTHER = "__other__";
  const personOptions = $derived([
    { value: "", label: "(unassigned)" },
    ...withCurrent(
      form.people.map((p) => ({ value: p.unique_name, label: `${p.name}  ${p.unique_name}` })),
    ),
    { value: OTHER, label: "someone else: type their email…" },
  ]);

  const choiceOptions = $derived([
    ...(spec.required ? [] : [{ value: "", label: "(none)" }]),
    ...withCurrent((spec.allowed_values ?? []).map((v) => ({ value: String(v), label: String(v) }))),
  ]);

  /** Allowed values arrive as strings or numbers; send back what ADO listed. */
  function pickChoice(v: string) {
    const original = spec.allowed_values?.find((a) => String(a) === v);
    onchange(v === "" ? null : (original ?? v));
  }
</script>

{#if kind === "path"}
  <Select
    value={current}
    options={pathOptions}
    searchable
    aria-label={spec.name}
    onchange={(v) => onchange(String(v))}
  />
{:else if kind === "person"}
  {#if typingPerson}
    <input
      {id}
      class:invalid
      type="email"
      placeholder="name@company.com"
      value={current}
      aria-label={spec.name}
      onchange={(e) => onchange((e.target as HTMLInputElement).value.trim() || null)}
      onkeydown={(e) => e.key === "Escape" && (typingPerson = false)}
    />
  {:else}
    <Select
      value={current}
      options={personOptions}
      searchable
      aria-label={spec.name}
      onchange={(v) => (v === OTHER ? (typingPerson = true) : onchange(String(v) || null))}
    />
  {/if}
{:else if kind === "choice"}
  <Select value={current} options={choiceOptions} aria-label={spec.name} onchange={(v) => pickChoice(String(v))} />
{:else if kind === "bool"}
  <Checkbox checked={value === true} ariaLabel={spec.name} onchange={(c) => onchange(c)} />
{:else if kind === "number"}
  <input
    {id}
    class:invalid
    type="number"
    step={spec.type === "double" ? "any" : "1"}
    value={current}
    aria-label={spec.name}
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
    aria-label={spec.name}
    onchange={(e) => onchange((e.target as HTMLInputElement).value || null)}
  />
{:else if kind === "text"}
  <textarea
    {id}
    class:invalid
    rows="3"
    value={current}
    aria-label={spec.name}
    oninput={(e) => onchange((e.target as HTMLTextAreaElement).value)}
  ></textarea>
{:else}
  <input
    {id}
    class:invalid
    value={current}
    aria-label={spec.name}
    placeholder={spec.reference_name === "System.Tags" ? "tag; another tag" : ""}
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
</style>
