<script lang="ts">
  import { themeState } from "./theme.svelte";

  let { target, controls }: { target: HTMLElement | undefined; controls?: string } = $props();

  /* Must stay equal to the --row height below: the row maths here and the
     cells painted there have to agree, at every font scale. */
  const ROW_REM = 0.9;
  const rowPx = () =>
    ROW_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);

  let bar = $state<HTMLDivElement>();
  let ROW = $state(16);
  let rows = $state(0);
  let thumbStart = $state(0);
  let thumbLen = $state(1);
  let visible = $state(false);
  let pct = $state(0);
  let dragging = false;

  function update() {
    const el = target;
    if (!el) return;
    ROW = rowPx();
    visible = el.scrollHeight > el.clientHeight + 1;
    if (!visible) return;
    rows = Math.max(3, Math.floor(el.clientHeight / ROW) - 2);
    thumbLen = Math.min(rows, Math.max(1, Math.round((el.clientHeight / el.scrollHeight) * rows)));
    const maxScroll = el.scrollHeight - el.clientHeight;
    const p = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    thumbStart = Math.round(p * (rows - thumbLen));
    pct = Math.round(p * 100);
  }

  function seek(e: PointerEvent) {
    const el = target;
    if (!el || !bar) return;
    const row = (e.clientY - bar.getBoundingClientRect().top) / ROW - 1;
    const span = Math.max(1, rows - thumbLen);
    const p = Math.min(1, Math.max(0, (row - thumbLen / 2) / span));
    el.scrollTop = p * (el.scrollHeight - el.clientHeight);
  }

  function down(e: PointerEvent) {
    const el = target;
    if (!el || !bar) return;
    const row = (e.clientY - bar.getBoundingClientRect().top) / ROW;
    if (row < 1) return el.scrollBy({ top: -el.clientHeight * 0.9, behavior: "smooth" });
    if (row > rows + 1) return el.scrollBy({ top: el.clientHeight * 0.9, behavior: "smooth" });
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    seek(e);
  }

  $effect(() => {
    const el = target;
    if (!el) return;
    /* Read so a font-scale change re-runs this: it moves the row height without
       necessarily resizing the target, so neither observer below would fire. */
    themeState.fontScale;
    update();
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);

    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- it really is a scrollbar -->
  <div
    bind:this={bar}
    class="scrollbar"
    role="scrollbar"
    aria-controls={controls}
    aria-valuenow={pct}
    aria-orientation="vertical"
    tabindex="-1"
    onpointerdown={down}
    onpointermove={(e) => dragging && seek(e)}
    onpointerup={() => (dragging = false)}
    onlostpointercapture={() => (dragging = false)}
  >
    <span class="cap up" aria-hidden="true"></span>
    {#each { length: rows } as _, i}
      <span
        class="row"
        class:on={i >= thumbStart && i < thumbStart + thumbLen}
        aria-hidden="true"
      ></span>
    {/each}
    <span class="cap down" aria-hidden="true"></span>
  </div>
{/if}

<style>
  /* Drawn, not typed. This was a ▲░█▼ column on --font-mono, and neither
     bundled face carries those glyphs — every row came from whatever fallback
     the OS supplied, so the track drifted out of step with the row maths
     above on any machine whose fallback had different metrics. */
  .scrollbar {
    --row: 0.9rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 0.75rem;
    align-self: stretch;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .row,
  .cap {
    flex: none;
    height: var(--row);
    width: 0.4rem;
  }
  .row {
    background: color-mix(in srgb, var(--muted) 40%, transparent);
  }
  .row.on {
    background: var(--accent);
    border-radius: 1px;
  }
  .scrollbar:hover .row {
    background: color-mix(in srgb, var(--muted) 70%, transparent);
  }
  .scrollbar:hover .row.on {
    background: var(--accent);
  }

  /* Triangles from borders — the same reason as above, one step further: no
     glyph at all, so nothing to substitute. The cap keeps its full row height
     so the arrow slots stay exactly one ROW, which is what down() measures. */
  .cap {
    width: 0.6rem;
    display: grid;
    place-items: center;
  }
  .cap::before {
    content: "";
    width: 0;
    height: 0;
    border-left: 0.29rem solid transparent;
    border-right: 0.29rem solid transparent;
  }
  .cap.up::before {
    border-bottom: 0.39rem solid var(--muted);
  }
  .cap.down::before {
    border-top: 0.39rem solid var(--muted);
  }
</style>
