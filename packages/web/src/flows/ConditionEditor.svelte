<script lang="ts">
  import {
    CONDITION_OPS,
    type Condition,
    type ConditionOp,
    type FlowOption,
  } from "@tachy/contract";
  import Choice from "../settings/Choice.svelte";
  import { Icon, Select } from "../tui";
  import ConditionEditor from "./ConditionEditor.svelte";
  import OptionSelect from "./OptionSelect.svelte";

  let {
    value,
    connection = "",
    fields = [],
    onchange,
    onremove,
  }: {
    value: Condition;
    /** Whose items the field and value lists are read from. */
    connection?: string;
    /** What earlier steps returned, offered ahead of the item's fields. */
    fields?: FlowOption[];
    onchange: (next: Condition) => void;
    /** Present for a nested condition, which its group can drop. */
    onremove?: () => void;
  } = $props();

  const OP_LABELS: Record<ConditionOp, string> = {
    eq: "is",
    neq: "is not",
    in: "is one of",
    contains: "contains",
    matches: "matches",
    exists: "is set",
    gt: "is over",
    lt: "is under",
  };
  const ops = CONDITION_OPS.map((o) => ({ value: o, label: OP_LABELS[o] }));
  type Leaf = Extract<Condition, { field: string }>;
  const leaf = (): Condition => ({ field: "item.status", op: "eq", value: "" });

  const mode = $derived.by(() => {
    if ("all" in value) return "all";
    return "any" in value ? "any" : null;
  });
  const children = $derived.by(() => {
    if ("all" in value) return value.all;
    return "any" in value ? value.any : [];
  });

  function setChildren(next: Condition[]) {
    onchange(mode === "any" ? { any: next } : { all: next });
  }
  function setChild(at: number, next: Condition) {
    setChildren(children.map((x, j) => (j === at ? next : x)));
  }

  const listText = (v: unknown) => {
    if (Array.isArray(v)) return v.join(", ");
    return v == null ? "" : String(v);
  };
</script>

{#if mode}
  <div class="group">
    <div class="head">
      <Choice
        label="How the conditions combine"
        options={[
          { value: "all", label: "all of" },
          { value: "any", label: "any of" },
        ]}
        value={mode}
        onpick={(m) =>
          onchange(m === "any" ? { any: children } : { all: children })}
      />
      {#if onremove}
        <button class="x" aria-label="Remove this group" onclick={onremove}
          ><Icon name="close" size="0.85em" /></button
        >
      {/if}
    </div>
    {#each children as child, i (i)}
      <ConditionEditor
        value={child}
        {connection}
        {fields}
        onchange={(n) => setChild(i, n)}
        onremove={() => setChildren(children.filter((_, j) => j !== i))}
      />
    {/each}
    <div class="adds">
      <button class="add" onclick={() => setChildren([...children, leaf()])}
        ><Icon name="plus" size="0.85em" /> condition</button
      >
      <button
        class="add"
        onclick={() => setChildren([...children, { any: [leaf()] }])}
        ><Icon name="plus" size="0.85em" /> group</button
      >
    </div>
  </div>
{:else if "not" in value}
  <div class="group">
    <div class="head">
      <span class="k">not</span>
      {#if onremove}
        <button class="x" aria-label="Remove" onclick={onremove}
          ><Icon name="close" size="0.85em" /></button
        >
      {/if}
    </div>
    <ConditionEditor
      value={value.not}
      {connection}
      {fields}
      onchange={(n) => onchange({ not: n })}
    />
  </div>
{:else}
  {@const leaf = value as Leaf}
  <div class="leaf">
    <span class="field">
      <OptionSelect
        source="item.fields"
        deps={{ connection }}
        value={leaf.field}
        extra={fields}
        free
        label="Field"
        onchange={(v) => onchange({ ...leaf, field: v })}
      />
    </span>
    <span class="op">
      <Select
        value={leaf.op}
        options={ops}
        aria-label="Comparison"
        onchange={(v) => onchange({ ...leaf, op: v as ConditionOp })}
      />
    </span>
    {#if leaf.op !== "exists"}
      <span class="value">
        {#if leaf.op === "in"}
          <input
            aria-label="Values"
            value={listText(leaf.value)}
            oninput={(e) =>
              onchange({
                ...leaf,
                value: e.currentTarget.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })}
          />
        {:else if connection && leaf.field.startsWith("item.")}
          <OptionSelect
            source="item.values"
            deps={{ connection, field: leaf.field }}
            value={listText(leaf.value)}
            free
            label="Value"
            onchange={(v) => onchange({ ...leaf, value: v })}
          />
        {:else}
          <input
            aria-label="Value"
            value={listText(leaf.value)}
            oninput={(e) => onchange({ ...leaf, value: e.currentTarget.value })}
          />
        {/if}
      </span>
    {/if}
    {#if onremove}
      <button class="x" aria-label="Remove this condition" onclick={onremove}
        ><Icon name="close" size="0.85em" /></button
      >
    {/if}
  </div>
{/if}

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    padding: var(--pad-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
  }
  .group :global(.group) {
    border-style: dashed;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-2);
  }
  .k {
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    text-transform: uppercase;
    color: var(--muted);
  }
  .leaf {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr) auto;
    grid-template-areas: "field field x" "op value .";
    align-items: center;
    gap: var(--pad-1);
  }
  .leaf .field {
    grid-area: field;
  }
  .leaf .op {
    grid-area: op;
  }
  .leaf .value {
    grid-area: value;
  }
  .leaf .x {
    grid-area: x;
  }
  .leaf > span > :global(*) {
    width: 100%;
  }
  .leaf input {
    width: 100%;
  }
  .adds {
    display: flex;
    gap: var(--pad-2);
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: var(--pad-1);
    padding: 2px var(--pad-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-control);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .add:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .x {
    display: inline-flex;
    padding: 3px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover {
    color: var(--danger);
  }
</style>
