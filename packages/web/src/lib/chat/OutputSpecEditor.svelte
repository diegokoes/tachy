<script lang="ts" module>
  export type CellType = "string" | "number" | "date" | "boolean";

  export interface SpecColumn {
    key: string;
    label?: string;
    type: CellType;
    required?: boolean;
    description?: string;
  }

  export interface OutputSpec {
    format: "xlsx" | "csv";
    sheet?: string;
    filename?: string;
    columns: SpecColumn[];
  }

  export interface ArtifactSpec {
    utilities?: string[];
    output?: OutputSpec;
  }

  export const EXPORT_UTILITY = "export_table";

  export function emptyColumn(): SpecColumn {
    return { key: "", type: "string" };
  }

  /** Drops half-written rows and returns undefined when nothing usable is declared. */
  export function toArtifactSpec(
    enabled: boolean,
    output: OutputSpec,
  ): ArtifactSpec | undefined {
    if (!enabled) return undefined;
    const columns = output.columns
      .filter((c) => c.key.trim())
      .map((c) => ({
        key: c.key.trim(),
        type: c.type,
        ...(c.label?.trim() ? { label: c.label.trim() } : {}),
        ...(c.required ? { required: true } : {}),
        ...(c.description?.trim() ? { description: c.description.trim() } : {}),
      }));
    if (!columns.length) return undefined;
    return {
      utilities: [EXPORT_UTILITY],
      output: {
        format: output.format,
        ...(output.sheet?.trim() ? { sheet: output.sheet.trim() } : {}),
        ...(output.filename?.trim()
          ? { filename: output.filename.trim() }
          : {}),
        columns,
      },
    };
  }
</script>

<script lang="ts">
  import AsciiSelect from "../AsciiSelect.svelte";

  let {
    enabled = $bindable(),
    output = $bindable(),
  }: { enabled: boolean; output: OutputSpec } = $props();

  const TYPES = ["string", "number", "date", "boolean"];
  const FORMATS = [
    { value: "xlsx", label: "xlsx" },
    { value: "csv", label: "csv" },
  ];

  const kebab = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  function add() {
    output.columns = [...output.columns, emptyColumn()];
  }

  function remove(i: number) {
    output.columns = output.columns.filter((_, n) => n !== i);
  }

  function move(i: number, delta: number) {
    const to = i + delta;
    if (to < 0 || to >= output.columns.length) return;
    const next = [...output.columns];
    [next[i], next[to]] = [next[to], next[i]];
    output.columns = next;
  }
</script>

<div class="os">
  <label class="toggle">
    <input type="checkbox" bind:checked={enabled} />
    <span>produces a file (declare the columns a turn must fill)</span>
  </label>

  {#if enabled}
    <div class="row">
      <label>format
        <AsciiSelect bind:value={output.format} options={FORMATS} />
      </label>
      {#if output.format === "xlsx"}
        <label>sheet
          <input bind:value={output.sheet} placeholder="Tickets" />
        </label>
      {/if}
      <label>filename
        <input bind:value={output.filename} placeholder="escalations-{'{date}'}" />
      </label>
    </div>

    <div class="cols-head">
      <span>columns</span>
      <button class="mini" onclick={add}>+ column</button>
    </div>

    {#if output.columns.length === 0}
      <p class="muted">No columns yet — add one.</p>
    {/if}

    <ul class="cols">
      {#each output.columns as col, i (i)}
        <li class="col">
          <div class="col-main">
            <input
              class="key"
              bind:value={col.key}
              onblur={() => (col.key = kebab(col.key))}
              placeholder="ticket_id"
              aria-label="column key"
            />
            <input
              class="lbl"
              bind:value={col.label}
              placeholder="Ticket"
              aria-label="column label"
            />
            <span class="type">
              <AsciiSelect bind:value={col.type} options={TYPES} aria-label="column type" />
            </span>
            <label class="req" title="required">
              <input type="checkbox" bind:checked={col.required} />
              <span>req</span>
            </label>
            <span class="acts">
              <button class="ghost" title="move up" onclick={() => move(i, -1)}>↑</button>
              <button class="ghost" title="move down" onclick={() => move(i, 1)}>↓</button>
              <button class="ghost" title="remove" onclick={() => remove(i)}>✕</button>
            </span>
          </div>
          <input
            class="desc"
            bind:value={col.description}
            placeholder="what goes in this column (shown to the agent)"
            aria-label="column description"
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .os {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }
  .toggle {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .row label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .cols-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .cols-head span { flex: 1; }
  .cols {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.35rem 0.45rem;
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .col-main {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .col input, .desc { font: inherit; color: var(--text); }
  .key { flex: 1 1 8rem; min-width: 0; }
  .lbl { flex: 1 1 8rem; min-width: 0; }
  .type { flex: 0 0 7rem; }
  .req {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .desc { width: 100%; font-size: 0.78rem; }
  .acts { display: flex; gap: 0.15rem; }
  .acts .ghost { padding: 0.1rem 0.35rem; font-size: 0.75rem; }
  .muted { color: var(--muted); margin: 0; font-size: 0.78rem; }
</style>
