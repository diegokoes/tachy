<script lang="ts">
  import { onMount, tick } from "svelte";
  import { keyCaps } from "../keys/bindings.svelte";
  import Stars from "../motion/Stars.svelte";
  import { scatter } from "../motion/stars";
  import { router } from "../shell/router.svelte";
  import { CaretInput, Icon, NoMatch, Scrim, Scrollbar } from "../tui";
  import { enterDialog, isTopDialog, leaveDialog } from "../tui/dialogs.svelte";
  import { portal } from "../tui/portal";
  import { loadWikis, wikis } from "../wiki/wikis.svelte";
  import { rank, runs } from "./fuzzy";
  import { places, type Place } from "./places";
  import { countPick, picks } from "./usage";

  let { onclose }: { onclose: () => void } = $props();

  /** About StarField's density over a surface this size. */
  const SKY = 64;
  /** Rows a PageUp or PageDown moves the cursor. */
  const PAGE_ROWS = 8;
  /** An empty clip, for when no row is lit. */
  const UNLIT = "inset(50%)";

  const stars = scatter(SKY);
  const counts = picks();
  const me = Symbol();
  const openedAt = router.path;
  // Read before the input mounts and takes focus.
  const restore = document.activeElement as HTMLElement | null;

  let query = $state("");
  let cursor = $state(0);
  let input = $state<HTMLInputElement>();
  let surface = $state<HTMLElement>();
  let list = $state<HTMLElement>();
  let litEl = $state<HTMLElement>();
  let rowEls = $state<HTMLElement[]>([]);
  let lit = $state(UNLIT);

  const catalogue = $derived(places());
  const results = $derived(rank(catalogue, query, counts));
  const at = $derived(Math.min(cursor, results.length - 1));

  function move(delta: number) {
    const n = results.length;
    if (!n) return;
    cursor =
      Math.abs(delta) === 1
        ? (at + delta + n) % n
        : Math.max(0, Math.min(n - 1, at + delta));
  }

  function pick(place: Place) {
    countPick(place.id);
    place.run();
    onclose();
  }

  function onkey(e: KeyboardEvent) {
    if (!isTopDialog(me)) return;
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Tab") move(e.shiftKey ? -1 : 1);
    else if (e.key === "PageDown") move(PAGE_ROWS);
    else if (e.key === "PageUp") move(-PAGE_ROWS);
    else if (e.key === "Enter" && results[at]) pick(results[at].item);
    else if (e.key === "Escape") onclose();
    else return;
    // Kept from the window, where a view's own list binds the same keys.
    e.preventDefault();
    e.stopPropagation();
  }

  // The lit layer is the base sky again, clipped to the highlighted row, so
  // the stars under the cursor brighten in place instead of a second set
  // being drawn per row.
  function measure() {
    const row = rowEls[at];
    if (!row || !litEl || !list) {
      lit = UNLIT;
      return;
    }
    const box = litEl.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const top = Math.max(r.top, view.top) - box.top;
    const bottom = box.bottom - Math.min(r.bottom, view.bottom);
    lit = `inset(${top}px ${box.right - r.right}px ${bottom}px ${r.left - box.left}px round var(--radius))`;
  }

  $effect(() => {
    void results;
    rowEls[at]?.scrollIntoView({ block: "nearest" });
    measure();
  });

  $effect(() => {
    if (!surface) return;
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  });

  // It belongs to the place it opened over: a binding that navigates under
  // it, ctrl+, for one, closes it.
  $effect(() => {
    if (router.path !== openedAt) onclose();
  });

  const capsOf = (chord: string) =>
    keyCaps(chord)
      .map((caps) => caps.join("+"))
      .join(" ");

  let pressedStage = false;

  onMount(() => {
    enterDialog(me, { sinkBelow: true });
    input?.focus();
    if (!wikis.loaded) void loadWikis();
    return () => {
      leaveDialog(me);
      // Only when nothing took focus meanwhile: a create opens its form, and a
      // view can focus its own field as it mounts.
      void tick().then(() => {
        const now = document.activeElement;
        if ((!now || now === document.body) && restore?.isConnected)
          restore.focus();
      });
    };
  });
</script>

<div class="over" use:portal>
  <Scrim />
  <div
    class="stage"
    role="presentation"
    onpointerdown={(e) => (pressedStage = e.target === e.currentTarget)}
    onclick={(e) => {
      if (pressedStage && e.target === e.currentTarget) onclose();
      pressedStage = false;
    }}
  >
    <div
      class="surface"
      role="dialog"
      aria-modal="true"
      aria-label="command palette"
      bind:this={surface}
    >
      <div class="sky"><Stars {stars} /></div>

      <div class="prompt">
        <span class="glass" aria-hidden="true"><Icon name="search" /></span>
        <CaretInput
          bind:value={query}
          bind:el={input}
          role="combobox"
          aria-label="go to"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[at] ? `palette-row-${at}` : undefined}
          spellcheck="false"
          onkeydown={onkey}
          oninput={() => (cursor = 0)}
        />
      </div>

      {#if results.length}
        <div class="rows">
          <div
            class="list"
            id="palette-list"
            role="listbox"
            bind:this={list}
            onscroll={measure}
          >
            {#each results as r, i (r.item.id)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="row"
                class:on={i === at}
                class:create={r.item.kind === "create"}
                id="palette-row-{i}"
                role="option"
                aria-selected={i === at}
                tabindex="-1"
                bind:this={rowEls[i]}
                onpointermove={() => (cursor = i)}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => pick(r.item)}
              >
                <span class="gutter" aria-hidden="true"
                  >{i === at ? "›" : ""}</span
                >
                <span class="icon" aria-hidden="true"
                  ><Icon name={r.item.icon ?? "next"} size="1em" /></span
                >
                <span class="label"
                  >{#each runs(r.item.label, r.hits) as run}{#if run.hit}<mark
                        >{run.text}</mark
                      >{:else}{run.text}{/if}{/each}</span
                >
                {#if r.item.trail.length}
                  <span class="trail">{r.item.trail.join(" › ")}</span>
                {/if}
                {#if r.item.hotkey}
                  <kbd class="key">{capsOf(r.item.hotkey)}</kbd>
                {/if}
              </div>
            {/each}
          </div>
          <Scrollbar target={list} controls="palette-list" />
        </div>
      {:else}
        <div class="none">
          {#key query}<NoMatch onclear={() => (query = "")} />{/key}
        </div>
      {/if}

      <div class="sky lit" style:clip-path={lit} bind:this={litEl}>
        <Stars {stars} still />
      </div>
    </div>
  </div>
</div>

<style>
  .over {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
  }
  /* Hung from the top rather than centred, so the input stays put while the
     list under it shrinks to the query. */
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 16vh var(--pad-4) var(--pad-4);
  }

  /* A dialog's plate, so it reads as one of the family. Isolated, so the sky
     can sit under the rows (z -1) and the lit copy between a row's fill and
     its text (z 1 and 2). */
  .surface {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    width: min(36rem, 100%);
    max-height: calc(100dvh - 16vh - var(--pad-4));
    background: var(--dialog-bg);
    border: var(--panel-line);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px var(--drop);
    overflow: hidden;
  }
  .sky {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .sky.lit {
    z-index: 1;
    --star-ink: var(--accent);
  }
  .sky.lit :global(.star) {
    text-shadow: 0 0 0.4em var(--accent);
  }

  .prompt {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    min-height: var(--control-h);
    padding: var(--pad-1) var(--pad-3);
    border-bottom: var(--panel-line);
    font-size: var(--fs-lg);
  }
  .glass {
    display: inline-flex;
    color: var(--accent);
  }

  .rows {
    display: flex;
    min-height: 0;
    padding: var(--pad-1) var(--pad-1) var(--pad-1) var(--pad-2);
  }
  .list {
    flex: 1;
    min-width: 0;
    max-height: calc(var(--row-h) * 10);
    overflow: auto;
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar {
    display: none;
  }

  /* Transparent until highlighted, so the sky reads through every row. */
  .row {
    display: flex;
    align-items: center;
    gap: var(--pad-2);
    height: var(--row-h);
    padding: 0 var(--pad-2) 0 0;
    border: var(--panel-line-w) solid transparent;
    border-radius: var(--radius);
    font-size: var(--fs-md);
    cursor: pointer;
    white-space: nowrap;
  }
  .row > * {
    position: relative;
    z-index: 2;
  }
  .row.on {
    background: var(--accent-dim);
    border-color: var(--accent);
  }
  .gutter {
    flex: none;
    width: 1.5ch;
    text-align: center;
    color: var(--accent);
  }
  .icon {
    flex: none;
    display: inline-flex;
    color: var(--muted);
  }
  .row.on .icon,
  .row.create .icon {
    color: var(--accent);
  }
  .label {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  .trail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: var(--fs-xs);
  }
  .key {
    flex: none;
    margin-left: auto;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    letter-spacing: var(--label-spacing);
    color: var(--muted);
  }

  .none {
    padding: var(--pad-3) var(--pad-4);
  }
</style>
