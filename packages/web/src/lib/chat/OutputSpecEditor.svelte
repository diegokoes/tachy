<script lang="ts" module>
  import {
    columnHeading,
    columnKeys,
    fieldName,
    outputFilename,
    stripFilenameChars,
    stripSheetChars,
    DEFAULT_SHEET,
  } from "@tachy/contract";
  import type {
    TableCellType,
    TableColumn,
    TableOutput,
  } from "@tachy/contract";

  export {
    columnKeys,
    fieldName,
    stripFilenameChars,
    stripSheetChars,
    DEFAULT_SHEET,
  };

  export type CellType = TableCellType;
  export type SpecColumn = TableColumn;
  export type OutputSpec = TableOutput;

  export interface ArtifactSpec {
    utilities?: string[];
    output?: OutputSpec;
  }

  export const EXPORT_UTILITY = "export_table";

  export function emptyColumn(): SpecColumn {
    return { key: "", type: "string" };
  }

  /** What still stops this output from being saved, in the user's words. */
  export function outputProblem(
    enabled: boolean,
    output: OutputSpec,
  ): string | null {
    if (!enabled) return null;
    if (!output.columns.length)
      return "add a column, or turn the output file off";
    if (output.columns.some((c) => !columnHeading(c)))
      return "every column needs a heading";
    return null;
  }

  export function toArtifactSpec(
    enabled: boolean,
    output: OutputSpec,
  ): ArtifactSpec | undefined {
    if (!enabled) return undefined;
    const keys = columnKeys(output.columns);
    const columns = output.columns
      .map((c, i) => ({ c, key: keys[i] }))
      .filter(({ key }) => key)
      .map(({ c, key }) => ({
        key,
        type: c.type,
        label: columnHeading(c),
        ...(c.required ? { required: true } : {}),
        ...(c.description?.trim() ? { description: c.description.trim() } : {}),
      }));
    if (!columns.length) return undefined;
    return {
      utilities: [EXPORT_UTILITY],
      output: {
        format: output.format,
        ...(output.sheet?.trim()
          ? { sheet: stripSheetChars(output.sheet.trim()) }
          : {}),
        ...(output.filename?.trim()
          ? { filename: stripFilenameChars(output.filename.trim()) }
          : {}),
        columns,
      },
    };
  }

  /** The server's own naming, so the preview is the real download name. */
  export const previewFilename = (output: OutputSpec, slug: string) =>
    outputFilename(output, slug || "artifact");
</script>

<script lang="ts">
  import { Button, Checkbox, Field, Select, G } from "../tui";

  let {
    enabled = $bindable(),
    output = $bindable(),
    slug = "",
  }: { enabled: boolean; output: OutputSpec; slug?: string } = $props();

  const TYPES = [
    { value: "string", label: "text" },
    { value: "number", label: "number" },
    { value: "date", label: "date" },
    { value: "boolean", label: "yes / no" },
  ];
  const FORMATS = [
    { value: "xlsx", label: "Excel (.xlsx)" },
    { value: "csv", label: "CSV (.csv)" },
  ];

  const keys = $derived(columnKeys(output.columns));
  const preview = $derived(previewFilename(output, slug));

  /** The key follows the heading until someone gives it a life of its own. */
  function setHeading(i: number, value: string) {
    const col = output.columns[i];
    const linked = !col.key || col.key === fieldName(col.label ?? "");
    col.label = value;
    if (linked) col.key = fieldName(value);
  }

  function sanitize(
    e: Event & { currentTarget: HTMLInputElement },
    clean: (s: string) => string,
  ): string {
    const value = clean(e.currentTarget.value);
    e.currentTarget.value = value;
    return value;
  }

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
  <div class="head-row">
    <label class="toggle">
      <Checkbox bind:checked={enabled} ariaLabel="output file" />
      <span class="ttl">output file</span>
    </label>
    {#if enabled}
      <span class="preview" title="the name the download arrives with">
        <span class="arrow" aria-hidden="true">{G.right}</span>{preview}
      </span>
    {/if}
  </div>

  {#if enabled}
    <div class="meta">
      <Field label="file type">
        <Select bind:value={output.format} options={FORMATS} aria-label="file type" />
      </Field>
      <Field label="file name">
        <input
          value={output.filename ?? ""}
          oninput={(e) => (output.filename = sanitize(e, stripFilenameChars))}
          title="Optional — defaults to the artifact name and today's date. {'{date}'} becomes today's date, {'{slug}'} the artifact name; the extension is added for you."
          aria-label="file name"
        />
      </Field>
      {#if output.format === "xlsx"}
        <Field label="tab name">
          <input
            value={output.sheet ?? ""}
            oninput={(e) => (output.sheet = sanitize(e, stripSheetChars))}
            title="Optional — the sheet tab inside the workbook, max 31 characters. Defaults to {DEFAULT_SHEET}."
            aria-label="tab name"
          />
        </Field>
      {/if}
    </div>

    <div class="cols-head">
      <span class="ttl">columns</span>
      <Button variant="ghost" tone="ok" size="sm" icon="plus" onclick={add}>
        column
      </Button>
    </div>

    {#if output.columns.length === 0}
      <p class="lede">No columns yet — add the first one.</p>
    {/if}

    <ol class="cols">
      {#each output.columns as col, i (i)}
        <li class="col">
          <span class="idx">{i + 1}</span>

          <div class="f-head">
            <Field label="heading" required hint={keys[i] || " "}>
              <input
                value={col.label ?? col.key}
                oninput={(e) => setHeading(i, e.currentTarget.value)}
                aria-label="column heading"
              />
            </Field>
          </div>

          <div class="f-type">
            <Field label="cell type" hint=" ">
              <Select bind:value={col.type} options={TYPES} aria-label="cell type" />
            </Field>
          </div>

          <label class="req" title="the agent may not leave this column empty">
            <Checkbox
              checked={!!col.required}
              onchange={(v) => (col.required = v)}
              ariaLabel="required"
            />
            <span>required</span>
          </label>

          <span class="acts">
            <Button
              variant="ghost"
              tone="danger"
              square
              icon="cancel"
              title="remove column"
              aria-label="remove column"
              onclick={() => remove(i)}
            />
            <Button
              variant="ghost"
              square
              icon="moveUp"
              title="move up"
              aria-label="move column up"
              disabled={i === 0}
              onclick={() => move(i, -1)}
            />
            <Button
              variant="ghost"
              square
              icon="moveDown"
              title="move down"
              aria-label="move column down"
              disabled={i === output.columns.length - 1}
              onclick={() => move(i, 1)}
            />
          </span>

          <div class="f-desc">
            <Field label="what goes in it">
              <input bind:value={col.description} aria-label="column description" />
            </Field>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .os {
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
    padding-top: var(--pad-3);
    border-top: 1px solid var(--border);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    color: var(--text);
  }
  .ttl {
    font-size: var(--fs-sm);
    letter-spacing: var(--label-spacing);
    color: var(--text);
  }
  .lede {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .meta {
    display: grid;
    grid-template-columns: minmax(9rem, 1fr) minmax(13rem, 2fr) minmax(9rem, 1fr);
    gap: var(--pad-2) var(--gap);
    align-items: start;
  }
  @media (max-width: 46rem) {
    .meta {
      grid-template-columns: 1fr;
    }
  }

  .head-row {
    display: flex;
    align-items: center;
    gap: var(--pad-3);
    min-width: 0;
  }
  .preview {
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arrow {
    margin-right: var(--pad-1);
    color: var(--muted);
  }

  .cols-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pad-2);
    margin-top: var(--pad-2);
  }

  .cols {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pad-2);
  }
  /* Two text fields down the left, the two small controls stacked beside them,
     the row actions outside both — so nothing is a lone control in open space. */
  .col {
    display: grid;
    grid-template-columns: 1.2rem minmax(10rem, 1fr) 9rem auto;
    grid-template-areas:
      "idx head type acts"
      "idx desc req  acts";
    gap: var(--pad-1) var(--gap);
    align-items: end;
    padding: var(--pad-2) var(--pad-3);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  @media (max-width: 46rem) {
    .col {
      grid-template-columns: 1.2rem minmax(0, 1fr) auto;
      grid-template-areas:
        "idx head acts"
        "idx type acts"
        "idx req  acts"
        "idx desc desc";
    }
  }

  .idx {
    grid-area: idx;
    align-self: start;
    padding-top: 0.1rem;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .f-head { grid-area: head; min-width: 0; }
  .f-type { grid-area: type; min-width: 0; }
  .f-desc { grid-area: desc; min-width: 0; }
  .f-type :global(.asel) {
    width: 100%;
  }

  .req {
    grid-area: req;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding-bottom: var(--pad-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .acts {
    grid-area: acts;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: var(--pad-1);
  }
</style>
