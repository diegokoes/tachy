<script lang="ts">
  // Terminal-style scrollbar: ▲/▼ caps, ░ track, segmented █ thumb in accent.
  // The target keeps native scrolling (wheel/keys) with its real bar hidden;
  // this mirrors it and supports click-to-jump, drag, and paging via the arrows.
  let { target, controls }: { target: HTMLElement | undefined; controls?: string } = $props();

  const ROW = 16; // px per character cell (font is 12px in a 16px line → visible gaps)

  let bar = $state<HTMLDivElement>();
  let rows = $state(0); // track rows, excluding the two arrow caps
  let thumbStart = $state(0);
  let thumbLen = $state(1);
  let visible = $state(false);
  let pct = $state(0);
  let dragging = false;

  function update() {
    const el = target;
    if (!el) return;
    visible = el.scrollHeight > el.clientHeight + 1;
    if (!visible) return;
    rows = Math.max(3, Math.floor(el.clientHeight / ROW) - 2);
    thumbLen = Math.min(rows, Math.max(1, Math.round((el.clientHeight / el.scrollHeight) * rows)));
    const maxScroll = el.scrollHeight - el.clientHeight;
    const p = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    thumbStart = Math.round(p * (rows - thumbLen));
    pct = Math.round(p * 100);
  }

  const track = $derived("▲\n" + "░\n".repeat(rows) + "▼");
  const thumb = $derived("\n".repeat(1 + thumbStart) + "█\n".repeat(thumbLen));

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
    update();
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Streamed replies grow scrollHeight without scroll events.
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
    class="ascii-scrollbar"
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
    <pre class="layer track">{track}</pre>
    <pre class="layer thumb">{thumb}</pre>
  </div>
{/if}

<style>
  .ascii-scrollbar {
    position: relative;
    width: 1.25ch;
    align-self: stretch;
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .layer {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    white-space: pre;
    font: 12px/16px monospace;
    text-align: center;
    pointer-events: none;
  }
  .track { color: var(--muted); opacity: 0.55; }
  .thumb { color: var(--accent); }
  .ascii-scrollbar:hover .track { opacity: 0.85; }
</style>
