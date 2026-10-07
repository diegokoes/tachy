<script lang="ts">
  import { themeState } from "../theme/theme.svelte";

  let {
    target,
    controls,
  }: { target: HTMLElement | undefined; controls?: string } = $props();

  // Must stay equal to the --row height in this file's styles: the row maths
  // and the painted cells have to agree at every font scale.
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
    thumbLen = Math.min(
      rows,
      Math.max(1, Math.round((el.clientHeight / el.scrollHeight) * rows)),
    );
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
    if (row < 1)
      return el.scrollBy({ top: -el.clientHeight * 0.9, behavior: "smooth" });
    if (row > rows + 1)
      return el.scrollBy({ top: el.clientHeight * 0.9, behavior: "smooth" });
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    seek(e);
  }

  $effect(() => {
    const el = target;
    if (!el) return;
    // Read so a font-scale change re-runs this: it moves the row height without
    // necessarily resizing the target, so neither observer would fire.
    themeState.fontScale;
    update();

    // `update` reads getComputedStyle and four layout properties. The observers
    // fire on every mutation of the subtree, once per streamed token in the
    // chat transcript, so they are coalesced onto a frame.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    el.addEventListener("scroll", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);

    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      ro.disconnect();
      mo.disconnect();
    };
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- it is a scrollbar -->
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
  /* Drawn, not typed: neither bundled face carries ▲░█▼, and an OS
     fallback's metrics would put the track out of step with the row maths. */
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
    background: var(--accent-fill);
    border-radius: 1px;
  }
  .scrollbar:hover .row {
    background: color-mix(in srgb, var(--muted) 70%, transparent);
  }
  .scrollbar:hover .row.on {
    background: var(--accent-fill);
  }

  /* Triangles from borders, for the same reason: no glyph, so nothing to
     substitute. The cap keeps its full row height so each arrow slot is one
     row, which is what down() measures. */
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
