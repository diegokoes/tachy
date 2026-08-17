<script lang="ts">
  type Val = string | number;
  type Opt = { value: Val; label: string; disabled?: boolean };
  type OptIn = Opt | string | number;

  let {
    value = $bindable(),
    options,
    title,
    disabled = false,
    active = false,
    onchange,
    "aria-label": ariaLabel,
  }: {
    value: Val;
    options: OptIn[];
    title?: string;
    disabled?: boolean;
    /** Holds a non-default value — worn as an accent border, so a narrowed
     *  list is visible without a separate "N active" counter. */
    active?: boolean;
    onchange?: (v: Val) => void;
    "aria-label"?: string;
  } = $props();

  const opts = $derived(
    options.map((o) =>
      typeof o === "object" ? o : { value: o, label: String(o) },
    ) as Opt[],
  );

  let open = $state(false);
  let cursor = $state(0); 
  let dropUp = $state(false); 
  let root: HTMLDivElement;
  let listEl: HTMLDivElement | undefined = $state();

  const selectedIndex = $derived(opts.findIndex((o) => o.value === value));
  const label = $derived(
    selectedIndex >= 0 ? opts[selectedIndex].label : "",
  );

  function openPanel() {
    if (disabled) return;
    cursor = selectedIndex >= 0 ? selectedIndex : 0;
    const r = root?.getBoundingClientRect();
    const below = r ? window.innerHeight - r.bottom : Infinity;
    const est = Math.min(opts.length * 32 + 8, 240);
    dropUp = !!r && below < est && r.top > below;
    open = true;
  }
  function close() {
    open = false;
  }
  function choose(i: number) {
    const o = opts[i];
    if (!o || o.disabled) return;
    value = o.value;
    onchange?.(o.value);
    close();
  }
  function step(dir: number) {
    const n = opts.length;
    let i = cursor;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!opts[i]?.disabled) break;
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
        if (open) { e.preventDefault(); cursor = 0; if (opts[0]?.disabled) step(1); }
        break;
      case "End":
        if (open) { e.preventDefault(); cursor = opts.length - 1; if (opts[cursor]?.disabled) step(-1); }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        open ? choose(cursor) : openPanel();
        break;
      case "Escape":
        if (open) { e.preventDefault(); close(); }
        break;
      case "Tab":
        close();
        break;
    }
  }

  function onWindowPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) close();
  }

  $effect(() => {
    if (!open || !listEl) return;
    const el = listEl.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="asel" class:open class:up={dropUp} bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:active
    {title}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    onclick={() => (open ? close() : openPanel())}
    onkeydown={onKeydown}
  >
    <span class="label">{label}</span>
    <span class="arrow" aria-hidden="true">▼</span>
  </button>

  {#if open}
    <div class="panel" role="listbox" bind:this={listEl} tabindex="-1">
      {#each opts as o, i}
        <div
          class="opt"
          class:cursor={i === cursor}
          class:selected={o.value === value}
          class:disabled={o.disabled}
          role="option"
          tabindex="-1"
          aria-selected={o.value === value}
          onpointerenter={() => (cursor = i)}
          onpointerdown={(e) => { e.preventDefault(); choose(i); }}
        >
          <span class="mark" aria-hidden="true">{o.value === value ? "›" : " "}</span>
          <span class="txt">{o.label}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .asel { position: relative; display: inline-flex; max-width: 100%; }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: var(--pad-2) var(--pad-3);
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    text-align: left;
  }
  .trigger.active {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .trigger:hover { border-color: var(--accent); color: var(--text); }
  .trigger:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .trigger:disabled { opacity: 0.5; cursor: default; }

  .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .arrow {
    flex: none;
    font-size: 0.7em;
    line-height: 1;
    color: var(--accent);
    transition: transform 0.12s;
  }
  .open .arrow { transform: rotate(180deg); }

  .panel {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
  }
  .up .panel {
    top: auto;
    bottom: calc(100% + 2px);
  }
  .panel {
    z-index: 40;
    min-width: 100%;
    width: max-content;
    max-width: min(90vw, 24rem);
    max-height: 15rem;
    overflow-y: auto;
    padding: 2px;
    background: var(--panel-bg);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
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
  .opt .mark { flex: none; width: 0.6em; color: var(--accent); }
  .opt.selected { color: var(--accent); }
  .opt.disabled { opacity: 0.4; cursor: default; }

  .opt.cursor {
    background: var(--accent);
    color: var(--bg);
  }
  .opt.cursor .mark { color: var(--bg); }
</style>
