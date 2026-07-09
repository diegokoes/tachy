<script lang="ts">
  type Val = string | number;
  type Opt = { value: Val; label: string; disabled?: boolean };
  type OptIn = Opt | string | number;

  let {
    value = $bindable(),
    options,
    title,
    disabled = false,
    onchange,
    "aria-label": ariaLabel,
  }: {
    value: Val;
    options: OptIn[];
    title?: string;
    disabled?: boolean;
    onchange?: (v: Val) => void;
    "aria-label"?: string;
  } = $props();

  const opts = $derived(
    options.map((o) =>
      typeof o === "object" ? o : { value: o, label: String(o) },
    ) as Opt[],
  );

  let open = $state(false);
  let active = $state(0); 
  let dropUp = $state(false); 
  let root: HTMLDivElement;
  let listEl: HTMLDivElement | undefined = $state();

  const selectedIndex = $derived(opts.findIndex((o) => o.value === value));
  const label = $derived(
    selectedIndex >= 0 ? opts[selectedIndex].label : "",
  );

  function openPanel() {
    if (disabled) return;
    active = selectedIndex >= 0 ? selectedIndex : 0;
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
    let i = active;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!opts[i]?.disabled) break;
    }
    active = i;
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
        if (open) { e.preventDefault(); active = 0; if (opts[0]?.disabled) step(1); }
        break;
      case "End":
        if (open) { e.preventDefault(); active = opts.length - 1; if (opts[active]?.disabled) step(-1); }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        open ? choose(active) : openPanel();
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
    const el = listEl.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  });
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="asel" class:open class:up={dropUp} bind:this={root}>
  <button
    type="button"
    class="trigger"
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
          class:active={i === active}
          class:selected={o.value === value}
          class:disabled={o.disabled}
          role="option"
          tabindex="-1"
          aria-selected={o.value === value}
          onpointerenter={() => (active = i)}
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
    padding: 0.4rem 0.5rem 0.4rem 0.65rem;
    font: inherit;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
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
    background: var(--panel-solid);
    border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
    border-radius: 2px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }

  .opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.28rem 0.5rem;
    white-space: nowrap;
    cursor: pointer;
    color: var(--text);
  }
  .opt .mark { flex: none; width: 0.6em; color: var(--accent); }
  .opt.selected { color: var(--accent); }
  .opt.disabled { opacity: 0.4; cursor: default; }

  .opt.active {
    background: var(--accent);
    color: var(--bg);
  }
  .opt.active .mark { color: var(--bg); }
</style>
