<script lang="ts">
  import Scrollbar from "./Scrollbar.svelte";
  import { float } from "./tui/float";

  type Val = string | number;
  type Opt = { value: Val; label: string; disabled?: boolean };
  type OptIn = Opt | string | number;

  let {
    value = $bindable(),
    options,
    title,
    disabled = false,
    active = false,
    keepOpen = false,
    searchable = false,
    filterPlaceholder = "filter…",
    placeholder,
    clearable,
    onchange,
    "aria-label": ariaLabel,
  }: {
    value: Val;
    /** readonly, so a vocabulary declared `as const` can be passed as it is. */
    options: readonly OptIn[];
    title?: string;
    disabled?: boolean;
    /** Holds a non-default value — worn as an accent border, so a narrowed
     *  list is visible without a separate "N active" counter. */
    active?: boolean;
    /**
     * Leave the panel up after a pick, and let a second click on the picked
     * option fall back to the empty one. For rows of filters, where the point
     * is trying values quickly rather than committing to one.
     */
    keepOpen?: boolean;
    /** Offer the filter box however short the list, for lists that grow with
     *  the catalog rather than staying a fixed vocabulary. */
    searchable?: boolean;
    filterPlaceholder?: string;
    /**
     * What the trigger says while nothing is picked. A filter row wants the
     * unfiltered state named ("any") without spending a list row on an
     * option that means "no option".
     */
    placeholder?: string;
    /**
     * Whether a second click on the picked option clears it. Defaults to
     * whether the list carries an empty option.
     */
    clearable?: boolean;
    onchange?: (v: Val) => void;
    "aria-label"?: string;
  } = $props();

  /** Below this a filter box costs more room than the scan it saves. */
  const FILTERABLE = 8;

  const opts = $derived(
    options.map((o) =>
      typeof o === "object" ? o : { value: o, label: String(o) },
    ) as Opt[],
  );

  let open = $state(false);
  let cursor = $state(0);
  let query = $state("");
  /*
   * When the list is short enough to skip the filter input, focus stays on the
   * trigger — so the trigger is what has to name the option the arrow keys are
   * on. That needs ids, and ids have to be unique per instance because this is
   * every dropdown in the product.
   */
  const uid = $props.id();
  const listId = `asel-${uid}`;
  const optId = (i: number) => `${listId}-opt-${i}`;

  let root: HTMLDivElement;
  let trigger = $state<HTMLElement>();
  let listEl: HTMLDivElement | undefined = $state();
  let scrollEl = $state<HTMLElement>();
  let queryEl = $state<HTMLInputElement>();

  const filterable = $derived(searchable || opts.length > FILTERABLE);
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => o.label.toLowerCase().includes(q));
  });

  const canClear = $derived(clearable ?? opts.some((o) => o.value === ""));
  const selectedIndex = $derived(opts.findIndex((o) => o.value === value));
  const label = $derived(
    selectedIndex >= 0 ? opts[selectedIndex].label : (placeholder ?? ""),
  );

  function openPanel() {
    if (disabled) return;
    query = "";
    cursor = Math.max(
      0,
      shown.findIndex((o) => o.value === value),
    );
    open = true;
  }
  function close() {
    open = false;
    query = "";
  }
  function choose(i: number) {
    const o = shown[i];
    if (!o || o.disabled) return;
    const next = keepOpen && canClear && o.value === value ? "" : o.value;
    value = next;
    onchange?.(next);
    if (!keepOpen) close();
  }
  function step(dir: number) {
    const n = shown.length;
    if (!n) return;
    let i = cursor;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!shown[i]?.disabled) break;
    }
    cursor = i;
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        open ? step(1) : openPanel();
        break;
      case "ArrowUp":
        e.preventDefault();
        open ? step(-1) : openPanel();
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          cursor = 0;
          if (shown[0]?.disabled) step(1);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          cursor = shown.length - 1;
          if (shown[cursor]?.disabled) step(-1);
        }
        break;
      case "Enter":
        e.preventDefault();
        open ? choose(cursor) : openPanel();
        break;
      case " ":
        /* Once a filter box has focus, space is a character. */
        if (open && filterable) break;
        e.preventDefault();
        open ? choose(cursor) : openPanel();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
          trigger?.focus();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }

  function onWindowPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) close();
  }

  /* A filtered list is a different list: the cursor has to land back on
     something that exists, or Enter commits whatever index it was left on. */
  $effect(() => {
    query;
    if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
  });

  $effect(() => {
    if (!open) return;
    queryEl?.focus();
  });

  $effect(() => {
    if (!open || !listEl) return;
    const el = listEl.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="asel" class:open bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:active
    bind:this={trigger}
    {title}
    {disabled}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? listId : undefined}
    aria-activedescendant={open && shown[cursor] ? optId(cursor) : undefined}
    aria-label={ariaLabel}
    onclick={() => (open ? close() : openPanel())}
    onkeydown={onKeydown}
  >
    <span class="label">{label}</span>
    <span class="arrow" aria-hidden="true">▼</span>
  </button>

  {#if open}
    <div class="panel" use:float={{ anchor: trigger, matchWidth: true }}>
      {#if filterable}
        <input
          class="q"
          type="text"
          bind:this={queryEl}
          bind:value={query}
          placeholder={filterPlaceholder}
          aria-label="filter options"
          autocomplete="off"
          onkeydown={onKeydown}
        />
      {/if}

      <div class="scroller">
        <div class="list" bind:this={listEl} tabindex="-1">
          <div
            class="rows"
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            bind:this={scrollEl}
          >
            {#each shown as o, i (o.value)}
              <div
                class="opt"
                id={optId(i)}
                class:cursor={i === cursor}
                class:selected={o.value === value}
                class:disabled={o.disabled}
                role="option"
                tabindex="-1"
                aria-selected={o.value === value}
                onpointerenter={() => (cursor = i)}
                onpointerdown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                <span class="mark" aria-hidden="true"
                  >{o.value === value ? "›" : " "}</span
                >
                <span class="txt">{o.label}</span>
              </div>
            {/each}
            {#if !shown.length}
              <p class="none">no match</p>
            {/if}
          </div>
        </div>
        <Scrollbar target={scrollEl} />
      </div>
    </div>
  {/if}
</div>

<style>
  .asel {
    position: relative;
    display: inline-flex;
    max-width: 100%;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: var(--control-h);
    padding: var(--pad-2) var(--pad-3);
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    cursor: pointer;
    text-align: left;
  }
  .trigger.active {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .trigger:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .trigger:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .arrow {
    flex: none;
    font-size: 0.7em;
    line-height: 1;
    color: var(--accent);
    transition: transform 0.12s;
  }
  .open .arrow {
    transform: rotate(180deg);
  }

  /* Placed by the float action, in viewport coordinates: as a child of the
     trigger this list was cropped by whatever dialog body it opened inside. */
  .panel {
    z-index: calc(var(--z-overlay) + 1);
    display: flex;
    flex-direction: column;
    width: max-content;
    max-width: min(90vw, 24rem);
    overflow: hidden;
    padding: 2px;
    background: var(--panel-bg);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: var(--radius-control);
    box-shadow: 0 4px 14px var(--drop);
  }

  .q {
    flex: none;
    margin-bottom: 2px;
    border-radius: calc(var(--radius-control) - 2px);
  }

  .scroller {
    display: flex;
    min-height: 0;
    gap: 2px;
  }
  .list {
    flex: 1;
    min-width: 0;
    display: flex;
    min-height: 0;
  }
  .rows {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .rows::-webkit-scrollbar {
    display: none;
  }

  .opt {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    padding: var(--pad-1) var(--pad-3);
    white-space: nowrap;
    cursor: pointer;
    color: var(--text);
  }
  .opt .mark {
    flex: none;
    width: 0.6em;
    color: var(--accent);
  }
  .opt.selected {
    color: var(--accent);
  }
  .opt.disabled {
    opacity: 0.4;
    cursor: default;
  }

  .opt.cursor {
    background: var(--accent);
    color: var(--bg);
  }
  .opt.cursor .mark {
    color: var(--bg);
  }

  .none {
    margin: 0;
    padding: var(--pad-2) var(--pad-3);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
</style>
