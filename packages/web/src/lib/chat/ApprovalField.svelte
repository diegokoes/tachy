<script lang="ts">
  import { Checkbox, Chip, Select } from "../tui";
  import { ENUM_FIELDS } from "../vocab";

  let {
    name,
    value,
    disabled = false,
    onchange,
  }: {
    name: string;
    value: unknown;
    disabled?: boolean;
    onchange: (v: unknown) => void;
  } = $props();

  /**
   * The widget comes from the shape of the value the model actually sent, not
   * from a tool schema — nothing carries one to the browser, and a tool nobody
   * anticipated still has to render. `ENUM_FIELDS` is the only per-key override.
   */
  type Kind = "enum" | "bool" | "number" | "list" | "text" | "line" | "json";

  const kind = $derived.by<Kind>(() => {
    if (name in ENUM_FIELDS && (typeof value === "string" || value == null))
      return "enum";
    if (typeof value === "boolean") return "bool";
    if (typeof value === "number") return "number";
    if (Array.isArray(value) && value.every((v) => typeof v === "string"))
      return "list";
    if (typeof value === "string")
      return value.includes("\n") || value.length > 80 ? "text" : "line";
    return "json";
  });

  const label = $derived(name.replaceAll("_", " "));
  const list = $derived(Array.isArray(value) ? (value as string[]) : []);

  let adding = $state("");
  let open = $state(false);

  function commitAdd() {
    const v = adding.trim();
    if (!v) return;
    onchange([...list, v]);
    adding = "";
  }

  /** Nested objects stay JSON — a generic form cannot do better, and the raw
      editor on the box is there for anything this cannot express. */
  let jsonText = $state("");
  let jsonBad = $state(false);
  /** What this field last emitted, so a re-seed can tell an outside change
      (the raw editor on the box) from the user's own typing — reformatting
      mid-keystroke would fight them. */
  let emitted = $state.raw<unknown>(Symbol("unset"));

  $effect(() => {
    if (value === emitted) return;
    jsonText = JSON.stringify(value, null, 2);
    jsonBad = false;
  });

  function commitJson(next: string) {
    jsonText = next;
    try {
      const parsed = JSON.parse(next) as unknown;
      emitted = parsed;
      onchange(parsed);
      jsonBad = false;
    } catch {
      jsonBad = true;
    }
  }

  const summary = $derived(
    value && typeof value === "object"
      ? `${Object.keys(value as object).length} keys`
      : "",
  );
</script>

<div class="field" class:inline={kind === "line" || kind === "enum" || kind === "bool" || kind === "number"}>
  <span class="label">{label}</span>

  {#if kind === "enum"}
    <Select
      value={(value as string) ?? ""}
      {disabled}
      aria-label={label}
      options={[
        { value: "", label: "unset" },
        ...ENUM_FIELDS[name].map((o) => ({ value: o, label: o })),
      ]}
      onchange={(v) => onchange(v === "" ? null : v)}
    />
  {:else if kind === "bool"}
    <Checkbox
      checked={value as boolean}
      {disabled}
      ariaLabel={label}
      onchange={(checked) => onchange(checked)}
    />
  {:else if kind === "number"}
    <input
      type="number"
      value={value as number}
      {disabled}
      aria-label={label}
      oninput={(e) => onchange(e.currentTarget.valueAsNumber)}
    />
  {:else if kind === "line"}
    <input
      value={(value as string) ?? ""}
      {disabled}
      aria-label={label}
      oninput={(e) => onchange(e.currentTarget.value)}
    />
  {:else if kind === "text"}
    <textarea
      value={(value as string) ?? ""}
      {disabled}
      aria-label={label}
      rows={Math.min(12, Math.max(2, String(value ?? "").split("\n").length + 1))}
      oninput={(e) => onchange(e.currentTarget.value)}
    ></textarea>
  {:else if kind === "list"}
    <div class="list">
      {#each list as item, i (i + item)}
        <Chip onremove={disabled ? undefined : () => onchange(list.filter((_, j) => j !== i))}>
          {item}
        </Chip>
      {/each}
      {#if !disabled}
        <input
          class="add"
          placeholder="+ add"
          bind:value={adding}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            }
          }}
          onblur={commitAdd}
        />
      {/if}
    </div>
  {:else}
    <button class="disclose" type="button" onclick={() => (open = !open)}>
      <span class="arrow">{open ? "▾" : "▸"}</span>
      {summary}
    </button>
    {#if open}
      <textarea
        class="json"
        class:bad={jsonBad}
        value={jsonText}
        {disabled}
        spellcheck="false"
        aria-label={label}
        oninput={(e) => commitJson(e.currentTarget.value)}
      ></textarea>
    {/if}
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
    min-width: 0;
  }
  /* Short scalars read better as label-then-control on one line — but only
     while there is room for both, so a narrow pane or a large font scale
     drops them back to stacked. */
  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: var(--gap);
    flex-wrap: wrap;
  }
  .field.inline .label {
    flex: none;
    min-width: 11ch;
  }
  .label {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }
  input,
  textarea {
    font: inherit;
    font-size: var(--fs-sm);
    min-width: 0;
  }
  .field:not(.inline) textarea,
  .field:not(.inline) input {
    width: 100%;
  }
  textarea {
    resize: vertical;
    line-height: 1.5;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pad-1);
  }
  .add {
    flex: 1 1 12ch;
    min-width: 12ch;
    border-color: transparent;
    background: transparent;
    font-size: var(--fs-xs);
  }
  .add:focus {
    border-color: var(--accent);
    background: var(--panel);
  }
  .disclose {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--pad-2);
    font: inherit;
    font-size: var(--fs-xs);
    color: var(--muted);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .disclose:hover {
    color: var(--accent);
  }
  .json {
    min-height: 8rem;
  }
  .json.bad {
    border-color: var(--danger);
  }
</style>
